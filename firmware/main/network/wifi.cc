#include "network/wifi.h"

#include <esp_log.h>
#include <esp_mac.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/task.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <utility>
#include <vector>

#include "utils/time_utils.h"

namespace {
constexpr char     kTag[]                 = "wifi";
constexpr int      kWifiBitConnected      = BIT0;
constexpr int      kWifiBitConnectionFail = BIT1;
constexpr int      kInitialFastFailCount  = 1;
constexpr int      kRuntimeFastFailCount  = 5;
constexpr int      kCandidateMaxWaitMs    = 6000;
constexpr int      kCandidateMinWaitMs    = 2500;
constexpr uint16_t kMaxInitialScanRecords = 40;

EventGroupHandle_t& WifiEventGroup() {
    static EventGroupHandle_t s_event_group = nullptr;
    return s_event_group;
}

void EnsureWifiEventGroup() {
    auto& event_group = WifiEventGroup();
    if (!event_group)
        event_group = xEventGroupCreate();
    configASSERT(event_group != nullptr);
}

bool FillStaConfig(wifi_config_t& wc, const std::string& ssid, const std::string& password, std::string* reason) {
    wc = {};
    if (ssid.empty()) {
        if (reason)
            *reason = "SSID 不能为空";
        return false;
    }
    if (ssid.size() > sizeof(wc.sta.ssid)) {
        if (reason)
            *reason = "SSID 过长";
        return false;
    }
    if (password.size() >= sizeof(wc.sta.password)) {
        if (reason)
            *reason = "Wi-Fi 密码过长";
        return false;
    }
    if (!password.empty() && password.size() < 8) {
        if (reason)
            *reason = "Wi-Fi 密码至少 8 位；开放网络请留空";
        return false;
    }
    std::memcpy(wc.sta.ssid, ssid.data(), ssid.size());
    std::memcpy(wc.sta.password, password.data(), password.size());
    wc.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wc.sta.pmf_cfg.capable    = true;
    wc.sta.pmf_cfg.required   = false;
    return true;
}

std::string WifiSsidToString(const uint8_t ssid[32]) {
    size_t len = 0;
    while (len < 32 && ssid[len] != 0)
        ++len;
    return std::string(reinterpret_cast<const char*>(ssid), len);
}

struct ConnectCandidate {
    Wifi::Network    network;
    bool             visible = false;
    wifi_ap_record_t ap{};
};

std::string DisconnectReasonZh(int reason) {
    switch (reason) {
        case 1:
            return "未指定原因";
        case 2:
            return "auth 失败";
        case 3:
            return "路由器主动断开(auth)";
        case 4:
            return "associate 超时";
        case 5:
            return "AP 客户端过多";
        case 6:
            return "未认证";
        case 7:
            return "未关联";
        case 8:
            return "本机断开(assoc-leave,常见于配置切换)";
        case 14:
            return "MIC 失败,密码错";
        case 15:
            return "4-way handshake 超时(密码错)";
        case 200:
            return "信号弱或路由器无 beacon";
        case 201:
            return "未找到该 SSID";
        case 202:
            return "认证失败,密码错";
        case 203:
            return "associate 失败";
        case 204:
            return "握手超时";
        case 205:
            return "连接失败";
        default: {
            char buf[48];
            std::snprintf(buf, sizeof(buf), "连接失败 (reason=%d)", reason);
            return buf;
        }
    }
}
}  // namespace

Wifi& Wifi::Get() {
    static Wifi w;
    return w;
}

void Wifi::EventHandler(void* arg, esp_event_base_t base, int32_t id, void* data) {
    Wifi* self = static_cast<Wifi*>(arg);

    if (base == WIFI_EVENT) {
        if (id == WIFI_EVENT_STA_DISCONNECTED) {
            auto*      d              = static_cast<wifi_event_sta_disconnected_t*>(data);
            const bool want_reconnect = self->want_reconnect_.load(std::memory_order_acquire);
            const int  fail_count     = self->fail_count_.load(std::memory_order_acquire);
            const int  max_fast_fail  = self->max_fast_fail_.load(std::memory_order_acquire);
            ESP_LOGW(kTag, "sta disconnected reason=%d want_reconnect=%d fail_count=%d max_fast_fail=%d", d->reason,
                     want_reconnect, fail_count, max_fast_fail);
            self->last_disconnect_reason_.store(d->reason, std::memory_order_release);
            self->ClearIpString();
            DisconnectCb on_disconnect;
            {
                std::lock_guard<std::mutex> lock(self->callback_mutex_);
                on_disconnect = self->on_disconnect_;
            }
            if (on_disconnect && !self->probe_connect_.load(std::memory_order_acquire))
                on_disconnect(d->reason);

            if (!want_reconnect) {
                self->state_.store(State::Disconnected);
                xEventGroupSetBits(WifiEventGroup(), kWifiBitConnectionFail);
                return;
            }

            if (fail_count < max_fast_fail) {
                self->fail_count_.fetch_add(1, std::memory_order_acq_rel);
                esp_err_t e = esp_wifi_connect();
                if (e != ESP_OK) {
                    ESP_LOGW(kTag, "sta reconnect failed err=%s", esp_err_to_name(e));
                }
                return;
            }

            self->state_.store(State::Disconnected);
            xEventGroupSetBits(WifiEventGroup(), kWifiBitConnectionFail);
            if (!self->selecting_network_.load(std::memory_order_acquire))
                self->reconnect_.Schedule();
            return;
        }

        if (id == WIFI_EVENT_SCAN_DONE) {
            if (self->reconnect_.ConsumeSlowScanPending()) {
                self->reconnect_.HandleSlowScanResult();
            }
            return;
        }
        return;
    }

    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto* e = static_cast<ip_event_got_ip_t*>(data);
        char  ip[INET6_ADDRSTRLEN];
        std::snprintf(ip, sizeof(ip), IPSTR, IP2STR(&e->ip_info.ip));
        self->SetIpString(ip);
        self->fail_count_.store(0, std::memory_order_release);
        self->reconnect_.ResetBackoff();
        self->reconnect_.Stop();
        self->state_.store(State::Connected);
        wifi_config_t wc = {};
        if (esp_wifi_get_config(WIFI_IF_STA, &wc) == ESP_OK) {
            const std::string           ssid = WifiSsidToString(wc.sta.ssid);
            std::lock_guard<std::mutex> lock(self->connection_mutex_);
            self->target_ssid_  = ssid;
            self->current_ssid_ = ssid;
        }
        xEventGroupSetBits(WifiEventGroup(), kWifiBitConnected);
        ConnectedCb on_connected;
        {
            std::lock_guard<std::mutex> lock(self->callback_mutex_);
            on_connected = self->on_connected_;
        }
        if (on_connected && !self->probe_connect_.load(std::memory_order_acquire))
            on_connected(self->GetSsid(), self->GetRssi());
        return;
    }
}

void Wifi::RegisterEventHandlers() {
    if (handler_wifi_ || handler_ip_)
        return;
    ESP_ERROR_CHECK(
        esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &EventHandler, this, &handler_wifi_));
    ESP_ERROR_CHECK(
        esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &EventHandler, this, &handler_ip_));
}

void Wifi::UnregisterEventHandlers() {
    if (handler_wifi_) {
        esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, handler_wifi_);
        handler_wifi_ = nullptr;
    }
    if (handler_ip_) {
        esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, handler_ip_);
        handler_ip_ = nullptr;
    }
}

void Wifi::Init() {
    std::lock_guard<std::mutex> init_lock(init_mutex_);
    if (inited_)
        return;

    esp_err_t err = esp_netif_init();
    ESP_ERROR_CHECK(err == ESP_ERR_INVALID_STATE ? ESP_OK : err);
    err = esp_event_loop_create_default();
    ESP_ERROR_CHECK(err == ESP_ERR_INVALID_STATE ? ESP_OK : err);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.nvs_enable         = false;
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    EnsureWifiEventGroup();
    inited_ = true;
}

bool Wifi::Connect(const std::string& ssid, const std::string& password, int timeout_ms) {
    return ConnectAny({Network{ssid, password}}, ssid, timeout_ms);
}

bool Wifi::ConnectAny(const std::vector<Network>& networks, const std::string& preferred_ssid, int timeout_ms) {
    Init();
    std::vector<Network> valid;
    valid.reserve(networks.size());
    for (const auto& network : networks) {
        wifi_config_t ignored = {};
        if (!FillStaConfig(ignored, network.ssid, network.password, nullptr))
            continue;
        const auto duplicate =
            std::find_if(valid.begin(), valid.end(), [&](const auto& item) { return item.ssid == network.ssid; });
        if (duplicate == valid.end())
            valid.push_back(network);
    }
    if (valid.empty()) {
        ESP_LOGW(kTag, "connect any failed reason=no_valid_networks");
        return false;
    }
    if (mode_.load(std::memory_order_acquire) == Mode::AccessPoint)
        StopApInternal();
    if (mode_.load(std::memory_order_acquire) != Mode::Station)
        StartStationInternal();

    {
        std::lock_guard<std::mutex> lock(connection_mutex_);
        known_networks_ = valid;
        current_ssid_.clear();
        target_ssid_.clear();
    }

    const int64_t deadline_ms = time_utils::NowMs() + std::max(timeout_ms, kCandidateMinWaitMs);
    selecting_network_.store(true, std::memory_order_release);
    want_reconnect_.store(false, std::memory_order_release);
    reconnect_.Stop();
    reconnect_.ResetBackoff();

    wifi_scan_config_t scan_cfg                                 = {};
    scan_cfg.show_hidden                                        = true;
    scan_cfg.scan_type                                          = WIFI_SCAN_TYPE_ACTIVE;
    scan_cfg.scan_time.active.min                               = 20;
    scan_cfg.scan_time.active.max                               = 80;
    uint16_t                                             ap_num = 0;
    std::array<wifi_ap_record_t, kMaxInitialScanRecords> records{};
    esp_err_t                                            scan_err = esp_wifi_scan_start(&scan_cfg, true);
    if (scan_err == ESP_OK) {
        esp_wifi_scan_get_ap_num(&ap_num);
        ap_num = std::min<uint16_t>(ap_num, kMaxInitialScanRecords);
        if (ap_num > 0)
            esp_wifi_scan_get_ap_records(&ap_num, records.data());
    } else {
        ESP_LOGW(kTag, "initial scan failed err=%s action=direct_connect", esp_err_to_name(scan_err));
    }
    if (!selecting_network_.load(std::memory_order_acquire) || mode_.load(std::memory_order_acquire) != Mode::Station) {
        ESP_LOGI(kTag, "connect any cancelled after scan");
        state_.store(State::Disconnected);
        return false;
    }

    std::vector<ConnectCandidate> candidates;
    candidates.reserve(valid.size());
    for (const auto& network : valid) {
        ConnectCandidate candidate;
        candidate.network = network;
        for (uint16_t i = 0; i < ap_num; ++i) {
            if (WifiSsidToString(records[i].ssid) != network.ssid)
                continue;
            if (!candidate.visible || records[i].rssi > candidate.ap.rssi) {
                candidate.visible = true;
                candidate.ap      = records[i];
            }
        }
        candidates.push_back(std::move(candidate));
    }
    std::stable_sort(candidates.begin(), candidates.end(), [&](const auto& a, const auto& b) {
        const bool a_preferred = a.network.ssid == preferred_ssid;
        const bool b_preferred = b.network.ssid == preferred_ssid;
        if (a.visible != b.visible)
            return a.visible;
        if (a_preferred != b_preferred)
            return a_preferred;
        return a.visible && b.visible ? a.ap.rssi > b.ap.rssi : false;
    });

    for (size_t i = 0; i < candidates.size(); ++i) {
        const int remaining_ms = static_cast<int>(deadline_ms - time_utils::NowMs());
        if (remaining_ms <= 0)
            break;
        const int candidates_left = static_cast<int>(candidates.size() - i);
        const int fair_share      = std::max(kCandidateMinWaitMs, remaining_ms / candidates_left);
        const int wait_ms         = candidates_left == 1 ? remaining_ms
                                                        : std::min({remaining_ms, fair_share, kCandidateMaxWaitMs});
        auto&     candidate       = candidates[i];

        wifi_config_t wc = {};
        if (!FillStaConfig(wc, candidate.network.ssid, candidate.network.password, nullptr))
            continue;
        if (candidate.visible) {
            wc.sta.bssid_set = 1;
            std::memcpy(wc.sta.bssid, candidate.ap.bssid, sizeof(wc.sta.bssid));
            wc.sta.channel = candidate.ap.primary;
        }
        const esp_err_t config_err = esp_wifi_set_config(WIFI_IF_STA, &wc);
        if (config_err != ESP_OK) {
            ESP_LOGW(kTag, "configure candidate failed ssid=%s err=%s", candidate.network.ssid.c_str(),
                     esp_err_to_name(config_err));
            if (!selecting_network_.load(std::memory_order_acquire))
                break;
            continue;
        }
        SetTargetSsid(candidate.network.ssid);
        ESP_LOGI(kTag, "connect candidate ssid=%s visible=%d rssi=%d attempt=%u total=%u wait_ms=%d",
                 candidate.network.ssid.c_str(), candidate.visible ? 1 : 0, candidate.visible ? candidate.ap.rssi : 0,
                 static_cast<unsigned>(i + 1), static_cast<unsigned>(candidates.size()), wait_ms);

        state_.store(State::Connecting);
        fail_count_.store(0, std::memory_order_release);
        last_disconnect_reason_.store(0, std::memory_order_release);
        max_fast_fail_.store(kInitialFastFailCount, std::memory_order_release);
        want_reconnect_.store(true, std::memory_order_release);
        xEventGroupClearBits(WifiEventGroup(), kWifiBitConnected | kWifiBitConnectionFail);
        const esp_err_t connect_err = esp_wifi_connect();
        if (connect_err != ESP_OK) {
            ESP_LOGW(kTag, "connect candidate start failed ssid=%s err=%s", candidate.network.ssid.c_str(),
                     esp_err_to_name(connect_err));
            want_reconnect_.store(false, std::memory_order_release);
            continue;
        }
        const EventBits_t bits = xEventGroupWaitBits(WifiEventGroup(), kWifiBitConnected | kWifiBitConnectionFail,
                                                     pdFALSE, pdFALSE, pdMS_TO_TICKS(wait_ms));
        if (!selecting_network_.load(std::memory_order_acquire) ||
            mode_.load(std::memory_order_acquire) != Mode::Station) {
            ESP_LOGI(kTag, "connect any cancelled");
            break;
        }
        if (bits & kWifiBitConnected) {
            selecting_network_.store(false, std::memory_order_release);
            max_fast_fail_.store(kRuntimeFastFailCount, std::memory_order_release);
            want_reconnect_.store(true, std::memory_order_release);
            esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
            return true;
        }
        ESP_LOGW(kTag, "connect candidate failed ssid=%s reason=%d", candidate.network.ssid.c_str(),
                 last_disconnect_reason_.load(std::memory_order_acquire));
        want_reconnect_.store(false, std::memory_order_release);
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    ESP_LOGW(kTag, "connect any failed profiles=%u last_reason=%d action=disable_auto_reconnect",
             static_cast<unsigned>(valid.size()), last_disconnect_reason_.load(std::memory_order_acquire));
    selecting_network_.store(false, std::memory_order_release);
    max_fast_fail_.store(kRuntimeFastFailCount, std::memory_order_release);
    want_reconnect_.store(false, std::memory_order_release);
    reconnect_.Stop();
    state_.store(State::Disconnected);
    return false;
}

bool Wifi::TryConnect(const std::string& ssid, const std::string& password, int timeout_ms, std::string& out_reason) {
    Init();
    if (ssid.empty()) {
        out_reason = "SSID 不能为空";
        return false;
    }
    if (mode_.load(std::memory_order_acquire) != Mode::AccessPoint) {
        out_reason = "TryConnect 必须在配网模式下调用";
        ESP_LOGE(kTag, "try connect failed reason=not_ap_mode");
        return false;
    }
    want_reconnect_.store(false, std::memory_order_release);
    fail_count_.store(0, std::memory_order_release);
    last_disconnect_reason_.store(0, std::memory_order_release);
    reconnect_.Stop();
    probe_connect_.store(true, std::memory_order_release);

    wifi_config_t wc = {};
    if (!FillStaConfig(wc, ssid, password, &out_reason)) {
        probe_connect_.store(false, std::memory_order_release);
        return false;
    }
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));

    constexpr int kMaxAttempts         = 3;
    constexpr int kPerAttemptTimeoutMs = 8000;
    const int     total_budget         = std::max(timeout_ms, kPerAttemptTimeoutMs);
    const int64_t deadline_ms          = time_utils::NowMs() + total_budget;

    int last_reason = 0;
    for (int attempt = 1; attempt <= kMaxAttempts; ++attempt) {
        const int64_t now_ms      = time_utils::NowMs();
        const int     budget_left = static_cast<int>(deadline_ms - now_ms);
        if (budget_left <= 0)
            break;
        const int wait_ms = std::min(budget_left, kPerAttemptTimeoutMs);

        xEventGroupClearBits(WifiEventGroup(), kWifiBitConnected | kWifiBitConnectionFail);
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK) {
            ESP_LOGW(kTag, "try connect attempt failed attempt=%d err=%s", attempt, esp_err_to_name(err));
            vTaskDelay(pdMS_TO_TICKS(300));
            continue;
        }

        EventBits_t bits = xEventGroupWaitBits(WifiEventGroup(), kWifiBitConnected | kWifiBitConnectionFail, pdFALSE,
                                               pdFALSE, pdMS_TO_TICKS(wait_ms));

        if (bits & kWifiBitConnected) {
            esp_wifi_disconnect();
            vTaskDelay(pdMS_TO_TICKS(100));
            state_.store(State::Idle);
            xEventGroupClearBits(WifiEventGroup(), kWifiBitConnected | kWifiBitConnectionFail);
            probe_connect_.store(false, std::memory_order_release);
            return true;
        }
        if (bits & kWifiBitConnectionFail) {
            last_reason = last_disconnect_reason_.load(std::memory_order_acquire);
            ESP_LOGW(kTag, "try connect attempt failed attempt=%d reason=%d", attempt, last_reason);
            vTaskDelay(pdMS_TO_TICKS(300));
        } else {
            ESP_LOGW(kTag, "try connect attempt timeout attempt=%d timeout_ms=%d", attempt, wait_ms);
            esp_wifi_disconnect();
            vTaskDelay(pdMS_TO_TICKS(200));
        }
    }

    if (last_reason != 0) {
        out_reason = DisconnectReasonZh(last_reason);
    } else {
        out_reason = "连接超时,可能信号弱或路由器无响应";
    }
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(100));
    probe_connect_.store(false, std::memory_order_release);
    ESP_LOGW(kTag, "try connect failed reason=%s", out_reason.c_str());
    return false;
}

void Wifi::Disconnect() {
    want_reconnect_.store(false, std::memory_order_release);
    reconnect_.Stop();
    if (mode_.load(std::memory_order_acquire) == Mode::Station)
        esp_wifi_disconnect();
    state_.store(State::Disconnected);
}

void Wifi::Stop() {
    want_reconnect_.store(false, std::memory_order_release);
    selecting_network_.store(false, std::memory_order_release);
    probe_connect_.store(false, std::memory_order_release);
    reconnect_.Stop();
    if (WifiEventGroup())
        xEventGroupSetBits(WifiEventGroup(), kWifiBitConnectionFail);
    const Mode mode = mode_.load(std::memory_order_acquire);
    if (mode == Mode::Station)
        StopStationInternal();
    else if (mode == Mode::AccessPoint)
        StopApInternal();
}

bool Wifi::IsConnected() const {
    return state_.load() == State::Connected;
}

int8_t Wifi::GetRssi() const {
    if (!IsConnected())
        return 0;
    wifi_ap_record_t r;
    if (esp_wifi_sta_get_ap_info(&r) == ESP_OK)
        return r.rssi;
    return 0;
}

std::string Wifi::GetIp() const {
    std::lock_guard<std::mutex> lock(ip_mutex_);
    return ip_str_;
}

std::string Wifi::GetSsid() const {
    std::lock_guard<std::mutex> lock(connection_mutex_);
    return current_ssid_;
}

void Wifi::SetIpString(const char* ip) {
    std::lock_guard<std::mutex> lock(ip_mutex_);
    std::snprintf(ip_str_, sizeof(ip_str_), "%s", ip ? ip : "");
}

void Wifi::ClearIpString() {
    SetIpString("");
}

bool Wifi::ReconnectAllowed() const {
    return want_reconnect_.load(std::memory_order_acquire);
}

bool Wifi::StationModeActive() const {
    return mode_.load(std::memory_order_acquire) == Mode::Station;
}

void Wifi::MarkSlowReconnectConnecting() {
    state_.store(State::Connecting);
}

void Wifi::ResetFastFailCount() {
    fail_count_.store(0, std::memory_order_release);
}

void Wifi::SetTargetSsid(const std::string& ssid) {
    std::lock_guard<std::mutex> lock(connection_mutex_);
    target_ssid_ = ssid;
}

std::string Wifi::TargetSsid() const {
    std::lock_guard<std::mutex> lock(connection_mutex_);
    return target_ssid_;
}

bool Wifi::ConfigureBestKnownNetwork(const wifi_ap_record_t* records, size_t count, bool prefer_alternative) {
    std::vector<Network> networks;
    std::string          failed_target;
    {
        std::lock_guard<std::mutex> lock(connection_mutex_);
        networks      = known_networks_;
        failed_target = target_ssid_;
    }
    struct Match {
        Network          network;
        wifi_ap_record_t ap;
    };
    std::vector<Match> matches;
    for (const auto& network : networks) {
        const wifi_ap_record_t* strongest = nullptr;
        for (size_t i = 0; i < count; ++i) {
            if (WifiSsidToString(records[i].ssid) != network.ssid)
                continue;
            if (!strongest || records[i].rssi > strongest->rssi)
                strongest = &records[i];
        }
        if (strongest)
            matches.push_back({network, *strongest});
    }
    if (matches.empty()) {
        if (networks.empty())
            return false;
        size_t     fallback_index = 0;
        const auto failed         = std::find_if(networks.begin(), networks.end(),
                                                 [&](const Network& network) { return network.ssid == failed_target; });
        if (failed != networks.end())
            fallback_index = (static_cast<size_t>(std::distance(networks.begin(), failed)) + 1) % networks.size();

        wifi_config_t wc       = {};
        const auto&   fallback = networks[fallback_index];
        if (!FillStaConfig(wc, fallback.ssid, fallback.password, nullptr))
            return false;
        const esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wc);
        if (err != ESP_OK) {
            ESP_LOGW(kTag, "direct retry config failed ssid=%s err=%s", fallback.ssid.c_str(), esp_err_to_name(err));
            return false;
        }
        SetTargetSsid(fallback.ssid);
        ESP_LOGI(kTag, "no saved ap found in scan; direct retry ssid=%s", fallback.ssid.c_str());
        return true;
    }
    std::sort(matches.begin(), matches.end(), [](const auto& a, const auto& b) { return a.ap.rssi > b.ap.rssi; });
    auto selected = matches.begin();
    if (prefer_alternative && matches.size() > 1) {
        const auto alternative = std::find_if(matches.begin(), matches.end(),
                                              [&](const auto& match) { return match.network.ssid != failed_target; });
        if (alternative != matches.end())
            selected = alternative;
    }

    wifi_config_t wc = {};
    if (!FillStaConfig(wc, selected->network.ssid, selected->network.password, nullptr))
        return false;
    wc.sta.bssid_set = 1;
    std::memcpy(wc.sta.bssid, selected->ap.bssid, sizeof(wc.sta.bssid));
    wc.sta.channel = selected->ap.primary;
    if (esp_wifi_set_config(WIFI_IF_STA, &wc) != ESP_OK)
        return false;
    SetTargetSsid(selected->network.ssid);
    ESP_LOGI(kTag, "slow reconnect candidate ssid=%s rssi=%d previous=%s", selected->network.ssid.c_str(),
             selected->ap.rssi, failed_target.c_str());
    return true;
}

bool Wifi::StartAp(const std::string& ssid_prefix) {
    Init();
    if (mode_.load(std::memory_order_acquire) == Mode::AccessPoint) {
        ESP_LOGW(kTag, "start ap ignored reason=already_ap_mode");
        return true;
    }
    StartApInternal(ssid_prefix);
    return true;
}

void Wifi::StopAp() {
    StopApInternal();
}

void Wifi::OnDisconnected(DisconnectCb cb) {
    std::lock_guard<std::mutex> lock(callback_mutex_);
    on_disconnect_ = std::move(cb);
}

void Wifi::OnConnected(ConnectedCb cb) {
    std::lock_guard<std::mutex> lock(callback_mutex_);
    on_connected_ = std::move(cb);
}

void Wifi::StartStationInternal() {
    sta_netif_ = esp_netif_create_default_wifi_sta();
    RegisterEventHandlers();
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    mode_.store(Mode::Station, std::memory_order_release);
}

void Wifi::StopStationInternal() {
    if (mode_.load(std::memory_order_acquire) != Mode::Station)
        return;
    reconnect_.Stop();
    UnregisterEventHandlers();
    esp_wifi_disconnect();
    esp_wifi_stop();
    if (sta_netif_) {
        esp_netif_destroy_default_wifi(sta_netif_);
        sta_netif_ = nullptr;
    }
    state_.store(State::Idle);
    want_reconnect_.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(connection_mutex_);
        target_ssid_.clear();
        current_ssid_.clear();
    }
    ClearIpString();
    mode_.store(Mode::Off, std::memory_order_release);
}

void Wifi::StartApInternal(const std::string& ssid_prefix) {
    if (mode_.load(std::memory_order_acquire) == Mode::Station)
        StopStationInternal();

    ap_netif_  = esp_netif_create_default_wifi_ap();
    sta_netif_ = esp_netif_create_default_wifi_sta();
    RegisterEventHandlers();

    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    char ssid[32];
    std::snprintf(ssid, sizeof(ssid), "%s-%02X%02X", ssid_prefix.c_str(), mac[4], mac[5]);

    wifi_config_t apc = {};
    std::strncpy(reinterpret_cast<char*>(apc.ap.ssid), ssid, sizeof(apc.ap.ssid) - 1);
    apc.ap.ssid_len        = std::strlen(ssid);
    apc.ap.channel         = 6;
    apc.ap.max_connection  = 4;
    apc.ap.authmode        = WIFI_AUTH_OPEN;
    apc.ap.beacon_interval = 100;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &apc));
    ESP_ERROR_CHECK(esp_wifi_start());
    mode_.store(Mode::AccessPoint, std::memory_order_release);
}

void Wifi::StopApInternal() {
    if (mode_.load(std::memory_order_acquire) != Mode::AccessPoint)
        return;
    reconnect_.Stop();
    UnregisterEventHandlers();
    esp_wifi_disconnect();
    esp_wifi_stop();
    if (ap_netif_) {
        esp_netif_destroy_default_wifi(ap_netif_);
        ap_netif_ = nullptr;
    }
    if (sta_netif_) {
        esp_netif_destroy_default_wifi(sta_netif_);
        sta_netif_ = nullptr;
    }
    state_.store(State::Idle);
    want_reconnect_.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(connection_mutex_);
        target_ssid_.clear();
        current_ssid_.clear();
    }
    ClearIpString();
    mode_.store(Mode::Off, std::memory_order_release);
}

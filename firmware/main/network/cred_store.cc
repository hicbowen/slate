#include "network/cred_store.h"

#include <cJSON.h>
#include <esp_log.h>

#include <algorithm>
#include <mutex>
#include <utility>

#include "storage/nvs/nvs_schema.h"
#include "storage/nvs/nvs_store.h"

namespace {
constexpr char kTag[] = "cred";
std::mutex profiles_mutex;

bool ValidProfile(const cred::WifiProfile& profile) {
    return !profile.ssid.empty() && profile.ssid.size() <= 32 && profile.password.size() < 64;
}

void NormalizeProfiles(cred::Credentials& c) {
    std::vector<cred::WifiProfile> normalized;
    normalized.reserve(std::min(c.wifi_profiles.size(), cred::kMaxWifiProfiles));
    for (auto& profile : c.wifi_profiles) {
        if (!ValidProfile(profile))
            continue;
        auto duplicate = std::find_if(normalized.begin(), normalized.end(),
                                      [&](const auto& item) { return item.ssid == profile.ssid; });
        if (duplicate != normalized.end())
            continue;
        normalized.push_back(std::move(profile));
        if (normalized.size() == cred::kMaxWifiProfiles)
            break;
    }
    c.wifi_profiles = std::move(normalized);

    const auto last = std::find_if(c.wifi_profiles.begin(), c.wifi_profiles.end(),
                                   [&](const auto& item) { return item.ssid == c.last_success_ssid; });
    if (last == c.wifi_profiles.end())
        c.last_success_ssid = c.wifi_profiles.empty() ? "" : c.wifi_profiles.front().ssid;
}

void PromoteProfile(cred::Credentials& c, cred::WifiProfile profile) {
    c.wifi_profiles.erase(std::remove_if(c.wifi_profiles.begin(), c.wifi_profiles.end(),
                                         [&](const auto& item) { return item.ssid == profile.ssid; }),
                          c.wifi_profiles.end());
    c.last_success_ssid = profile.ssid;
    c.wifi_profiles.insert(c.wifi_profiles.begin(), std::move(profile));
    if (c.wifi_profiles.size() > cred::kMaxWifiProfiles)
        c.wifi_profiles.resize(cred::kMaxWifiProfiles);
}

bool ParseWifiList(const std::string& json, cred::Credentials& out) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root)
        return false;
    cJSON* version  = cJSON_GetObjectItemCaseSensitive(root, "version");
    cJSON* last     = cJSON_GetObjectItemCaseSensitive(root, "last");
    cJSON* profiles = cJSON_GetObjectItemCaseSensitive(root, "profiles");
    if (!cJSON_IsNumber(version) || version->valueint != 1 || !cJSON_IsArray(profiles)) {
        cJSON_Delete(root);
        return false;
    }

    out.wifi_profiles.clear();
    if (cJSON_IsString(last) && last->valuestring)
        out.last_success_ssid = last->valuestring;
    cJSON* item = nullptr;
    cJSON_ArrayForEach(item, profiles) {
        if (out.wifi_profiles.size() == cred::kMaxWifiProfiles)
            break;
        cJSON* ssid     = cJSON_GetObjectItemCaseSensitive(item, "ssid");
        cJSON* password = cJSON_GetObjectItemCaseSensitive(item, "password");
        if (!cJSON_IsString(ssid) || !ssid->valuestring || !cJSON_IsString(password) || !password->valuestring)
            continue;
        out.wifi_profiles.push_back({ssid->valuestring, password->valuestring});
    }
    cJSON_Delete(root);
    NormalizeProfiles(out);
    return true;
}

std::string SerializeWifiList(const cred::Credentials& source) {
    cred::Credentials c = source;
    NormalizeProfiles(c);

    cJSON* root = cJSON_CreateObject();
    if (!root)
        return {};
    cJSON_AddNumberToObject(root, "version", 1);
    cJSON_AddStringToObject(root, "last", c.last_success_ssid.c_str());
    cJSON* profiles = cJSON_AddArrayToObject(root, "profiles");
    if (!profiles) {
        cJSON_Delete(root);
        return {};
    }
    for (const auto& profile : c.wifi_profiles) {
        cJSON* item = cJSON_CreateObject();
        if (!item)
            continue;
        cJSON_AddStringToObject(item, "ssid", profile.ssid.c_str());
        cJSON_AddStringToObject(item, "password", profile.password.c_str());
        cJSON_AddItemToArray(profiles, item);
    }
    char*       raw  = cJSON_PrintUnformatted(root);
    std::string json = raw ? raw : "";
    cJSON_free(raw);
    cJSON_Delete(root);
    return json;
}
}  // namespace

namespace cred {

bool Load(Credentials& out) {
    out              = {};
    out.wifi_enabled = nvs_store::GetInt8(nvs_schema::kNet, nvs_schema::net::kWifiOn, 1) != 0;
    std::string wifi_list, single_marker;
    WifiProfile single;
    nvs_store::GetStrings(nvs_schema::kNet, {
                                                {nvs_schema::net::kWifiList, &wifi_list},
                                                {nvs_schema::net::kWifiSingle, &single_marker},
                                                {nvs_schema::net::kSsid, &single.ssid},
                                                {nvs_schema::net::kPwd, &single.password},
                                                {nvs_schema::net::kUrl, &out.server_url},
                                                {nvs_schema::net::kDevId, &out.device_id},
                                                {nvs_schema::net::kDevSec, &out.device_secret},
                                            });
    const bool parsed = !wifi_list.empty() && ParseWifiList(wifi_list, out);
    if (!wifi_list.empty() && !parsed)
        ESP_LOGW(kTag, "wifi list invalid action=legacy_fallback");

    // The first v2 fork saved a single network after reprovisioning.
    // Keep that network as preferred and recover the other saved profiles.
    if ((!parsed || !single_marker.empty()) && ValidProfile(single))
        PromoteProfile(out, std::move(single));
    return !out.wifi_profiles.empty() && !out.server_url.empty();
}

static bool SaveProfiles(const Credentials& c) {
    const std::string wifi_list = SerializeWifiList(c);
    if (wifi_list.empty()) {
        ESP_LOGE(kTag, "save failed type=wifi_list_encode");
        return false;
    }
    bool ok = nvs_store::SetStrings(nvs_schema::kNet, {
                                                          {nvs_schema::net::kWifiList, wifi_list},
                                                          {nvs_schema::net::kUrl, c.server_url},
                                                          {nvs_schema::net::kWifiSingle, ""},
                                                      });
    if (!ok) {
        ESP_LOGE(kTag, "save failed type=credentials");
    }
    return ok;
}

bool UpsertWifiProfile(const std::string& ssid, const std::string& password, const std::string& server_url) {
    const std::lock_guard<std::mutex> lock(profiles_mutex);
    WifiProfile candidate{ssid, password};
    if (!ValidProfile(candidate) || server_url.empty())
        return false;
    Credentials c;
    Load(c);
    PromoteProfile(c, std::move(candidate));
    c.server_url = server_url;
    return SaveProfiles(c);
}

bool RemoveWifiProfile(const std::string& ssid) {
    const std::lock_guard<std::mutex> lock(profiles_mutex);
    Credentials c;
    Load(c);
    const auto old_size = c.wifi_profiles.size();
    c.wifi_profiles.erase(std::remove_if(c.wifi_profiles.begin(), c.wifi_profiles.end(),
                                         [&](const auto& profile) { return profile.ssid == ssid; }),
                          c.wifi_profiles.end());
    if (c.wifi_profiles.size() == old_size)
        return true;
    if (c.last_success_ssid == ssid)
        c.last_success_ssid = c.wifi_profiles.empty() ? "" : c.wifi_profiles.front().ssid;
    return SaveProfiles(c);
}

bool MarkWifiSucceeded(const std::string& ssid) {
    const std::lock_guard<std::mutex> lock(profiles_mutex);
    Credentials c;
    Load(c);
    auto it = std::find_if(c.wifi_profiles.begin(), c.wifi_profiles.end(),
                           [&](const auto& profile) { return profile.ssid == ssid; });
    if (it == c.wifi_profiles.end())
        return false;
    if (it == c.wifi_profiles.begin() && c.last_success_ssid == ssid &&
        nvs_store::HasString(nvs_schema::kNet, nvs_schema::net::kWifiList) &&
        !nvs_store::HasString(nvs_schema::kNet, nvs_schema::net::kWifiSingle))
        return true;
    WifiProfile connected = std::move(*it);
    c.wifi_profiles.erase(it);
    c.wifi_profiles.insert(c.wifi_profiles.begin(), std::move(connected));
    c.last_success_ssid = ssid;
    return SaveProfiles(c);
}

bool SetWifiEnabled(bool enabled) {
    const bool ok = nvs_store::SetInt8(nvs_schema::kNet, nvs_schema::net::kWifiOn, enabled ? 1 : 0);
    if (!ok)
        ESP_LOGE(kTag, "save failed type=wifi_enabled enabled=%d", enabled ? 1 : 0);
    return ok;
}

bool WifiEnabled() {
    return nvs_store::GetInt8(nvs_schema::kNet, nvs_schema::net::kWifiOn, 1) != 0;
}

bool SaveSecret(const std::string& device_id, const std::string& device_secret) {
    bool ok = nvs_store::SetStrings(nvs_schema::kNet, {
                                                          {nvs_schema::net::kDevId, device_id},
                                                          {nvs_schema::net::kDevSec, device_secret},
                                                      });
    if (!ok) {
        ESP_LOGE(kTag, "save failed type=secret");
        return false;
    }
    return true;
}

void ClearSecret() {
    // 保留 Wi-Fi 和 server url，只清内容服务端设备身份。
    nvs_store::EraseKey(nvs_schema::kNet, nvs_schema::net::kDevId);
    nvs_store::EraseKey(nvs_schema::kNet, nvs_schema::net::kDevSec);
    ESP_LOGW(kTag, "secret cleared action=reregister_next_boot");
}

std::string GetServerUrl() {
    return nvs_store::GetString(nvs_schema::kNet, nvs_schema::net::kUrl);
}

void Clear() {
    const std::lock_guard<std::mutex> lock(profiles_mutex);
    nvs_store::EraseNamespace(nvs_schema::kNet);
    // 不读旧 namespace，但恢复出厂时顺手清掉测试残留。
    nvs_store::EraseNamespace(nvs_schema::kLegacy);
}

}  // namespace cred

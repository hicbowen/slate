#include "network/cred_store.h"

#include <cJSON.h>
#include <esp_log.h>

#include <cstring>
#include <memory>

#include "storage/nvs/nvs_schema.h"
#include "storage/nvs/nvs_store.h"

namespace {
constexpr char kTag[] = "cred";

// Older fork firmware stored multiple networks. Prefer the last successful
// profile until the user saves credentials through the v2 provisioning page.
void LoadLegacyWifi(const std::string& json, cred::Credentials& out) {
    const std::unique_ptr<cJSON, decltype(&cJSON_Delete)> root(cJSON_Parse(json.c_str()), cJSON_Delete);
    if (!root)
        return;
    const cJSON* version = cJSON_GetObjectItemCaseSensitive(root.get(), "version");
    const cJSON* profiles = cJSON_GetObjectItemCaseSensitive(root.get(), "profiles");
    if (!cJSON_IsNumber(version) || version->valueint != 1 || !cJSON_IsArray(profiles))
        return;

    const char* last = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root.get(), "last"));
    bool found = false;
    const cJSON* item = nullptr;
    cJSON_ArrayForEach(item, profiles) {
        const char* ssid = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(item, "ssid"));
        const char* pwd = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(item, "password"));
        if (!ssid || !*ssid || std::strlen(ssid) > 32 || !pwd || std::strlen(pwd) >= 64)
            continue;
        const bool preferred = last && std::strcmp(ssid, last) == 0;
        if (!found || preferred) {
            out.wifi_ssid = ssid;
            out.wifi_pwd = pwd;
            found = true;
        }
        if (preferred)
            return;
    }
}
}  // namespace

namespace cred {

bool Load(Credentials& out) {
    std::string legacy_wifi, wifi_single;
    nvs_store::GetStrings(nvs_schema::kNet, {
                                                {nvs_schema::net::kLegacyWifiList, &legacy_wifi},
                                                {nvs_schema::net::kWifiSingle, &wifi_single},
                                                {nvs_schema::net::kSsid, &out.wifi_ssid},
                                                {nvs_schema::net::kPwd, &out.wifi_pwd},
                                                {nvs_schema::net::kUrl, &out.server_url},
                                                {nvs_schema::net::kDevId, &out.device_id},
                                                {nvs_schema::net::kDevSec, &out.device_secret},
                                            });
    if (wifi_single.empty() && !legacy_wifi.empty())
        LoadLegacyWifi(legacy_wifi, out);
    return !out.wifi_ssid.empty() && !out.server_url.empty();
}

bool Save(const Credentials& c) {
    bool ok = nvs_store::SetStrings(nvs_schema::kNet, {
                                                          {nvs_schema::net::kSsid, c.wifi_ssid},
                                                          {nvs_schema::net::kPwd, c.wifi_pwd},
                                                          {nvs_schema::net::kUrl, c.server_url},
                                                          {nvs_schema::net::kWifiSingle, "1"},
                                                      });
    if (!ok) {
        ESP_LOGE(kTag, "save failed type=credentials");
    }
    return ok;
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
    nvs_store::EraseNamespace(nvs_schema::kNet);
    // 不读旧 namespace，但恢复出厂时顺手清掉测试残留。
    nvs_store::EraseNamespace(nvs_schema::kLegacy);
}

}  // namespace cred

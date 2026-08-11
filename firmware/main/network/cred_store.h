#pragma once

// NVS 凭据存储:
//
// 1. 配网凭据 slate.net { wifi_list / wifi_on / url }:
//    wifi_list 是版本化 JSON，最多 5 组；legacy ssid/pwd 首次读取时自动迁移。
//
// 2. 内容服务端设备身份 slate.net { dev_id / dev_sec }:
//    register 响应里下发,SaveSecret() 单独写一次
//    并 commit,保证跨重启可见。后续所有受保护 API 用 Authorization: Bearer <device_secret>。
//    poll 收到 401 (secret 失效) 时调 ClearSecret() 让设备重启走 register 流,
//    不擦 wifi/server,体验上是"内部修复"而非"重新配网"。

#include <cstddef>
#include <string>
#include <vector>

namespace cred {

inline constexpr std::size_t kMaxWifiProfiles = 5;

struct WifiProfile {
    std::string ssid;
    std::string password;
};

struct Credentials {
    std::vector<WifiProfile> wifi_profiles;
    std::string              last_success_ssid;
    bool                     wifi_enabled = true;
    std::string              server_url;
    std::string              device_id;
    std::string              device_secret;
};

// Load 把 NVS 里所有字段读出来。返回 true 表示至少有一组 Wi-Fi + server_url (= 配网完整)。
// 首次运行 v2 固件时会把 legacy ssid/pwd 无感迁移到 wifi_list；旧 key 保留作回退。
// device_id/device_secret 可能为空 —— 表示首次启动或 self-reset 后,需要走 register。
bool Load(Credentials& out);

// 写完整的 Wi-Fi 列表 + server_url + Wi-Fi 开关。
// 不动 device_id/device_secret,保持身份与配网解耦。
bool Save(const Credentials& c);

// captive portal 验证成功后添加/更新一组网络。SSID 唯一；重复提交会更新密码并移到 MRU 首位。
// 超过 kMaxWifiProfiles 时淘汰最久未成功使用的末项。
bool UpsertWifiProfile(const std::string& ssid, const std::string& password, const std::string& server_url);

// 忘记一组网络。不会修改 server/device 身份。
bool RemoveWifiProfile(const std::string& ssid);

// 成功拿到 IP 后更新 MRU。当前已经是首项时不写 NVS，避免每次重连磨损 flash。
bool MarkWifiSucceeded(const std::string& ssid);

// 设备级 Wi-Fi 总开关；key 缺失（旧固件升级 / 工厂重置）默认 true。
bool SetWifiEnabled(bool enabled);
bool WifiEnabled();

// 独立 commit 设备身份。register 响应解析成功后立即调用一次。
// 半写保护:nvs_open RW → set 两个 key → commit → close,失败返回 false 由调用方决定 panic。
bool SaveSecret(const std::string& device_id, const std::string& device_secret);

// 清掉 device_id + device_secret,保留 wifi。下次启动会走 register 重新拿。
// 触发场景:poll 收到 401 (后端 reset 了我们 / DB 异常)。
void ClearSecret();

// 便利:从 NVS 读 server_url
std::string GetServerUrl();

// 工厂重置:清整个 namespace。Wi-Fi 开关恢复默认开启，下次启动进入配网模式。
void Clear();

}  // namespace cred

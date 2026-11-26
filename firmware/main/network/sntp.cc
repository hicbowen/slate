#include "network/sntp.h"

#include <esp_log.h>
#include <esp_netif_sntp.h>
#include <esp_sntp.h>
#include <sdkconfig.h>

#include <sys/time.h>
#include <cstdint>
#include <cstdlib>
#include <ctime>
#include <mutex>

namespace {
constexpr char kTag[] = "sntp";
std::mutex     sntp_mutex;
bool           running = false;

constexpr time_t kSyncedAfterEpoch = 1577836800;  // 2020-01-01 UTC
constexpr long   kMaxClockDriftSec = 10;
}  // namespace

namespace sntp {

void ConfigureTimezone() {
    setenv("TZ", CONFIG_SLATE_DEFAULT_TIMEZONE, 1);
    tzset();
}

void Init() {
    std::lock_guard<std::mutex> lock(sntp_mutex);
    if (running)
        return;
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    cfg.start             = true;
    running               = esp_netif_sntp_init(&cfg) == ESP_OK;
}

void Stop() {
    std::lock_guard<std::mutex> lock(sntp_mutex);
    if (!running)
        return;
    esp_netif_sntp_deinit();
    running = false;
}

bool TimeSynced() {
    time_t now = time(nullptr);
    return now > kSyncedAfterEpoch;
}

void ApplyServerTime(int64_t unix_ms) {
    const time_t server = static_cast<time_t>(unix_ms / 1000);
    if (server <= kSyncedAfterEpoch) {
        ESP_LOGW(kTag, "server time rejected value=%lld", (long long)unix_ms);
        return;
    }
    const time_t now  = time(nullptr);
    const long   diff = static_cast<long>(server - now);
    if (TimeSynced() && std::labs(diff) <= kMaxClockDriftSec)
        return;

    timeval tv{};
    tv.tv_sec  = server;
    tv.tv_usec = static_cast<suseconds_t>((unix_ms % 1000) * 1000);
    if (settimeofday(&tv, nullptr) != 0) {
        ESP_LOGW(kTag, "set time failed");
    }
}

}  // namespace sntp

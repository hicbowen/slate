#pragma once

#include <cstddef>
#include <cstdint>

#include <sdkconfig.h>

namespace display_profile {

inline constexpr int kMonoFrameBytes = 400 * 300 / 8;
inline constexpr int kGrayFrameBytes = 400 * 300 / 2;

#if CONFIG_SLATE_DISPLAY_NOTE4C
inline constexpr bool        kFourColor            = true;
inline constexpr int         kBitsPerPixel         = 2;
inline constexpr int         kBytesPerRow          = 400 / 4;
inline constexpr int         kFrameBytes           = kBytesPerRow * 300;
inline constexpr uint8_t     kWhiteByte            = 0x55;  // 01 白，4 像素/字节
inline constexpr const char* kFrameFormat          = "bwry2";
inline constexpr int         kMinRefreshIntervalMs = 12'000;
inline constexpr int         kRefreshIdleTimeoutMs = 130'000;
inline constexpr int         kBusyTimeoutMs        = 120'000;
inline constexpr int         kDebounceQuietMs      = 250;
inline constexpr int         kDebounceMaxMs        = 1'000;
#else
inline constexpr bool        kFourColor            = false;
inline constexpr int         kBitsPerPixel         = 1;
inline constexpr int         kBytesPerRow          = 400 / 8;
inline constexpr int         kFrameBytes           = kBytesPerRow * 300;
inline constexpr uint8_t     kWhiteByte            = 0xFF;
inline constexpr const char* kFrameFormat          = "mono1";
inline constexpr int         kMinRefreshIntervalMs = 300;
inline constexpr int         kRefreshIdleTimeoutMs = 45'000;
inline constexpr int         kBusyTimeoutMs        = 5'000;
inline constexpr int         kDebounceQuietMs      = 50;
inline constexpr int         kDebounceMaxMs        = 500;
#endif

inline constexpr int kMaxWireFrameBytes = kFourColor ? kFrameBytes : kGrayFrameBytes;

inline constexpr bool IsGrayFrameSize(size_t bytes) {
    return !kFourColor && bytes == kGrayFrameBytes;
}

// All panels can display a mono rendition.
inline constexpr bool IsWireFrameSize(size_t bytes) {
    return bytes == kMonoFrameBytes || bytes == kMaxWireFrameBytes;
}

}  // namespace display_profile

#pragma once

#include "drivers/display/display_profile.h"

namespace power_shutdown {

using PreShutdownHook = void (*)();

void SetPreShutdownHook(PreShutdownHook hook);
bool WaitForEpdAndShutdown(int epd_timeout_ms);

[[noreturn]] void GracefulRestart(int pre_delay_ms = 0, int epd_timeout_ms = display_profile::kRefreshIdleTimeoutMs);

}  // namespace power_shutdown

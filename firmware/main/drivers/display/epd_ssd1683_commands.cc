#include "drivers/display/epd_ssd1683.h"

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <cstring>

#include "drivers/display/framebuffer_ops.h"
#include "drivers/display/ssd2683_waveform.h"
#include "utils/time_utils.h"

void EpdSsd1683::EpdInit() {
    EpdPowerOn();
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(rst_, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(rst_, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(rst_, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
    ReadBusy();
#if !CONFIG_SLATE_DISPLAY_NOTE4C
    EpdSendCommand(0x00);
    EpdSendData(0x2F);
    EpdSendData(0x0E);
#endif
    EpdSendCommand(0xE9);
    EpdSendData(0x01);
    ReadBusy();
}

void EpdSsd1683::EpdHardwareReset() {
    gpio_set_level(rst_, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(rst_, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(rst_, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
    ReadBusy();
}

void EpdSsd1683::EpdSelectOtp() {
    EpdSendCommand(0x00);
    EpdSendData(0x2F);
    EpdSendData(0x0E);
    EpdSendCommand(0xE9);
    EpdSendData(0x01);
    ReadBusy();
}

void EpdSsd1683::EpdDisplayOtpWhiteBase() {
    ApplyTemperatureBoost();
    EpdSendCommand(0xA5);
    ReadBusy();
    vTaskDelay(pdMS_TO_TICKS(10));
    epd_line_.assign(100, 0x55);
    EpdSendCommand(0x10);
    for (int y = 0; y < kHeight; ++y)
        WriteBytes(epd_line_.data(), 100);
    EpdSendCommand(0x04);
    ReadBusy();
    EpdSendCommand(0x12);
    EpdSendData(0x00);
    ReadBusy();
    EpdSendCommand(0x02);
    EpdSendData(0x00);
    ReadBusy();
}

void EpdSsd1683::EpdInitExternalWaveform(const uint8_t* waveform, size_t size) {
    if (!waveform || size != ssd2683_waveform::kWaveformSize)
        return;
    EpdHardwareReset();
    EpdSendCommand(0x00);
    EpdSendData(0x2F);
    EpdSendData(0x8E);
    EpdSendCommand(0x01);
    const uint8_t power[] = {0x07, waveform[0], waveform[1], waveform[2], waveform[3], waveform[4]};
    for (uint8_t value : power)
        EpdSendData(value);
    EpdSendCommand(0x30);
    EpdSendData(waveform[6]);
    EpdSendCommand(0x82);
    EpdSendData(waveform[5]);
    EpdSendCommand(0x06);
    const uint8_t booster[] = {0x0F, 0x8B, 0x9C, 0xAA};
    for (uint8_t value : booster)
        EpdSendData(value);
    EpdSendCommand(0xE7);
    EpdSendData(0x98);
    EpdSendCommand(0x50);
    EpdSendData(0x37);
    EpdSendCommand(0x61);
    const uint8_t resolution[] = {0x01, 0x90, 0x01, 0x2C};
    for (uint8_t value : resolution)
        EpdSendData(value);
    EpdSendCommand(0x62);
    EpdSendData(0x64);
    EpdSendData(0x53);
    EpdSendCommand(0x65);
    for (int i = 0; i < 4; ++i)
        EpdSendData(0x00);
    EpdSendCommand(0xE9);
    EpdSendData(0x01);
    ReadBusy();
    EpdSendCommand(0x20);
    WriteBytes(waveform, static_cast<int>(size));
}

void EpdSsd1683::EpdLoadExternalWaveform(const uint8_t* waveform, size_t size) {
    if (!waveform || size != ssd2683_waveform::kWaveformSize)
        return;
    ReadBusy();
    EpdSendCommand(0x30);
    EpdSendData(waveform[6]);
    EpdSendCommand(0x20);
    WriteBytes(waveform, static_cast<int>(size));
}

void EpdSsd1683::EpdWriteGrayPass(int pass) {
    EpdSendCommand(0x10);
    ReadBusy();
    epd_line_.resize(100);
    for (int y = 0; y < kHeight; ++y) {
        for (int byte_x = 0; byte_x < 100; ++byte_x) {
            uint8_t packed = 0;
            for (int index = 0; index < 4; ++index) {
                const size_t pixel = static_cast<size_t>(y) * kWidth + byte_x * 4 + index;
                const uint8_t pair = gray_snapshot_[pixel / 2];
                const uint8_t level = (pixel & 1u) ? (pair & 0x0F) : (pair >> 4);
                const uint8_t code =
                    ssd2683_waveform::VendorGray16RenderPassOfLevel(level) == static_cast<size_t>(pass)
                        ? ssd2683_waveform::VendorGray16RenderCodeOfLevel(level)
                        : 0;
                packed |= static_cast<uint8_t>(code << (6 - index * 2));
            }
            epd_line_[byte_x] = packed;
        }
        WriteBytes(epd_line_.data(), 100);
    }
}

void EpdSsd1683::EpdTriggerExternalBatch(bool power_on) {
    if (power_on) {
        EpdSendCommand(0x04);
        ReadBusy();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    EpdSendCommand(0x12);
    EpdSendData(0x00);
    vTaskDelay(pdMS_TO_TICKS(10));
    ReadBusy();
}

void EpdSsd1683::EpdDisplayGray16() {
#if !CONFIG_SLATE_DISPLAY_NOTE4C
    // Official demo runs the external waveform path at 20 MHz.
    SpiPortInit(20 * 1000 * 1000);
    EpdPowerOn();
    vTaskDelay(pdMS_TO_TICKS(10));
    EpdHardwareReset();
    EpdSelectOtp();
    EpdDisplayOtpWhiteBase();
    // 白底阶段可能读取温度并临时切 SPI RX；显式重建 external path 的 20 MHz 总线。
    SpiPortInit(20 * 1000 * 1000);
    for (size_t pass = 0; pass < ssd2683_waveform::kVendorGray16RenderPassCount; ++pass) {
        const auto& waveform = ssd2683_waveform::kVendorGray16RenderWaveforms[pass];
        if (pass == 0)
            EpdInitExternalWaveform(waveform.data(), waveform.size());
        else
            EpdLoadExternalWaveform(waveform.data(), waveform.size());
        EpdWriteGrayPass(static_cast<int>(pass));
        EpdTriggerExternalBatch(pass == 0);
    }
    EpdSendCommand(0x02);
    EpdSendData(0x00);
    ReadBusy();
    EpdHardwareReset();
    EpdSelectOtp();
    EpdPowerOff();
    SpiPortInit();
#endif
}

void EpdSsd1683::ApplyTemperatureBoost() {
    // 0x40 = Get Temp,ReadBusy 后 EPD 把片内温度寄存器值放到 DI 上,SPI 反向读 1B。
    // 这次切换 SPI 模式约 5~10 ms，所以 60 s 内复用上次结果（屏温变化很慢）。
    constexpr int64_t kCacheValidMs = 60 * 1000;
    const int64_t     now_ms        = time_utils::NowMs();

    uint8_t booster;
    if (cached_booster_ != 0 && (now_ms - last_temp_read_ms_) < kCacheValidMs) {
        booster = cached_booster_;
    } else {
        EpdSendCommand(0x40);
        ReadBusy();
        const uint8_t temp = EpdRecvData();
        // 5 档:≤5°C 用 -24°C 偏置(0xE8),≤10 用 -21,≤20 用 -18,≤30 用 -15,
        // ≤127 用 -12;>127(寄存器异常)按最冷处理。
        if (temp <= 5)
            booster = 232;
        else if (temp <= 10)
            booster = 235;
        else if (temp <= 20)
            booster = 238;
        else if (temp <= 30)
            booster = 241;
        else if (temp <= 127)
            booster = 244;
        else
            booster = 232;
        cached_booster_    = booster;
        last_temp_read_ms_ = now_ms;
    }

    EpdSendCommand(0xE0);
    EpdSendData(0x02);
    EpdSendCommand(0xE6);
    EpdSendData(booster);
}

void EpdSsd1683::EpdDisplayFull() {
#if CONFIG_SLATE_DISPLAY_NOTE4C
    EpdSendCommand(0x10);
    for (int y = 0; y < kHeight; ++y) {
        std::memcpy(epd_line_.data(), snapshot_ + y * display_profile::kBytesPerRow, display_profile::kBytesPerRow);
        WriteBytes(epd_line_.data(), display_profile::kBytesPerRow);
    }
    EpdTurnOnDisplay();
#else
    int      bpr     = (kWidth + 7) >> 3;
    int      bpr_out = bpr * 2;
    uint8_t* line    = epd_line_.data();

    ApplyTemperatureBoost();
    EpdSendCommand(0xA5);  // Master Activation:加载 LUT(full 模式必需)
    ReadBusy();
    vTaskDelay(pdMS_TO_TICKS(10));

    EpdSendCommand(0x10);
    for (int y = 0; y < kHeight; ++y) {
        const uint8_t* src = snapshot_ + y * bpr;
        uint8_t*       dst = line;
        for (int xb = 0; xb < bpr; ++xb) {
            uint8_t a, b;
            epd::Pack1bppTo2683(src[xb], a, b);
            *dst++ = a;
            *dst++ = b;
        }
        WriteBytes(line, bpr_out);
    }
    EpdTurnOnDisplay();
#endif
}

void EpdSsd1683::EpdDisplayPartial() {
#if CONFIG_SLATE_DISPLAY_NOTE4C
    // Note4C 面板没有局刷波形；上层正常不会进入这里，兜底仍按全刷处理。
    EpdDisplayFull();
#else
    int      bpr     = (kWidth + 7) >> 3;
    int      bpr_out = bpr * 2;
    uint8_t* line    = epd_line_.data();

    // 不要重写 booster!
    // 之前这里调了 ApplyTemperatureBoost 想"低温补偿",但实测每次 partial 前
    // 发 0xE0 0xE6 会把 SSD1683 切回 boost-charge 状态,partial LUT 失效,
    // 屏幕看起来"日志在刷但完全没变化"。booster 在上一轮 FULL 路径的
    // ApplyTemperatureBoost + EpdInit 时已经设好,partial 复用即可。
    // 参考 esp32-eink/.../custom_lcd_display.cc:1135 EPD_DisplayPart 同样不写 booster。

    EpdSendCommand(0x10);
    ReadBusy();  // 跟参考实现对齐:0x10 之后等 BUSY 回 HIGH
    for (int y = 0; y < kHeight; ++y) {
        const uint8_t* prev = prev_snapshot_ + y * bpr;
        const uint8_t* now  = snapshot_ + y * bpr;
        for (int xb = 0; xb < bpr; ++xb) {
            epd::PackPartial1bppTo2683(prev[xb], now[xb], line[2 * xb + 0], line[2 * xb + 1]);
        }
        WriteBytes(line, bpr_out);
    }
    EpdTurnOnDisplay();
#endif
}

void EpdSsd1683::EpdTurnOnDisplay() {
    EpdSendCommand(0x04);  // power on
    ReadBusy();
    EpdSendCommand(0x12);  // display refresh
#if !CONFIG_SLATE_DISPLAY_NOTE4C
    EpdSendData(0x00);
#endif
    ReadBusy();
    EpdSendCommand(0x02);  // power off (controller internal)
    EpdSendData(0x00);
    ReadBusy();
#if CONFIG_SLATE_DISPLAY_NOTE4C
    // 四色参考驱动在每次全刷后进入 controller deep sleep，避免电荷泵持续耗电。
    EpdSendCommand(0x07);
    EpdSendData(0xA5);
#endif
    // 跟参考实现对齐:每次刷完屏都断 GPIO6,跟刷新前的 EpdInit() 内 EpdPowerOn 配对。
    // 见 esp32-eink/main/boards/zectrix-s3-epaper-4.2/custom_lcd_display.cc:826。
    EpdPowerOff();
}

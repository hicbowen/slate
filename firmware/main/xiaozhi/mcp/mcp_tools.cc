#include "xiaozhi/mcp/mcp_tools.h"

#include <cJSON.h>

#include <cstdint>
#include <mutex>
#include <utility>

#include "bsp/board.h"
#include "bsp/charge_status.h"
#include "network/wifi.h"
#include "storage/cache/cache.h"
#include "storage/nvs/volume_store.h"
#include "sync/api_client.h"
#include "sync/sync_service.h"
#include "utils/json_utils.h"
#include "xiaozhi/config/settings.h"
#include "xiaozhi/service/audio_service.h"
#include "xiaozhi/service/xiaozhi_service.h"

namespace xiaozhi::mcp {
namespace {

using json_utils::JsonId;
using json_utils::PrintAndDelete;

std::mutex pending_card_mutex;

struct CardTarget {
    std::string group_id;
    std::string content_id;
    std::string image_hash;
};
CardTarget pending_card;
CardTarget recent_note;

bool IsCardReady(const CardTarget& target) {
    if (target.image_hash.empty())
        return true;
    cache::CachedGroupSummary group;
    if (!cache::ReadCachedGroupSummary(group) || group.gid != target.group_id)
        return false;
    for (int i = 0; i < group.content_count; ++i) {
        cache::FrameMeta frame;
        if (cache::ReadFrameMeta(group.gid, i, frame) && frame.content_id == target.content_id)
            return frame.image_hash == target.image_hash;
    }
    return false;
}

cJSON* AddSlateTool(cJSON* tools, const char* name, const char* description, const char* required_string) {
    cJSON* tool = cJSON_CreateObject();
    cJSON_AddStringToObject(tool, "name", name);
    cJSON_AddStringToObject(tool, "description", description);
    cJSON* schema = cJSON_AddObjectToObject(tool, "inputSchema");
    cJSON_AddStringToObject(schema, "type", "object");
    cJSON* props = cJSON_AddObjectToObject(schema, "properties");
    cJSON* field = cJSON_AddObjectToObject(props, required_string);
    cJSON_AddStringToObject(field, "type", "string");
    cJSON* position = cJSON_AddObjectToObject(props, "position");
    cJSON_AddStringToObject(position, "type", "integer");
    cJSON_AddNumberToObject(position, "minimum", 1);
    cJSON_AddStringToObject(position, "description", "当前组内从 1 开始的卡片位置。仅当用户指定位置或需要区分同名卡片时使用。");
    cJSON_AddItemToArray(cJSON_AddArrayToObject(schema, "required"), cJSON_CreateString(required_string));
    cJSON_AddItemToArray(tools, tool);
    return props;
}

std::string XiaozhiStateName(XiaozhiState state) {
    switch (state) {
        case XiaozhiState::kCheckingConfig:
            return "checking_config";
        case XiaozhiState::kAwaitingActivation:
            return "awaiting_activation";
        case XiaozhiState::kReadyIdle:
            return "ready_idle";
        case XiaozhiState::kConnecting:
            return "connecting";
        case XiaozhiState::kListening:
            return "listening";
        case XiaozhiState::kSpeaking:
            return "speaking";
        case XiaozhiState::kStopping:
            return "stopping";
        case XiaozhiState::kError:
            return "error";
    }
    return "unknown";
}

std::string ChargeStateName(ChargeStatus::State state) {
    switch (state) {
        case ChargeStatus::State::kNoPower:
            return "no_power";
        case ChargeStatus::State::kCharging:
            return "charging";
        case ChargeStatus::State::kFull:
            return "full";
        case ChargeStatus::State::kNoBattery:
            return "no_battery";
    }
    return "unknown";
}

cJSON* MakeObjectSchema() {
    cJSON* schema = cJSON_CreateObject();
    cJSON_AddStringToObject(schema, "type", "object");
    cJSON_AddItemToObject(schema, "properties", cJSON_CreateObject());
    return schema;
}

}  // namespace

std::string BuildDeviceStatusJson() {
    cJSON* root = cJSON_CreateObject();

    cJSON*    audio         = cJSON_CreateObject();
    const int xiaozhi_level = settings::GetVolume();
    cJSON_AddNumberToObject(audio, "volume", vol::ToCodec(xiaozhi_level));
    cJSON_AddNumberToObject(audio, "level", xiaozhi_level);
    cJSON_AddNumberToObject(audio, "max_level", vol::kMax);
    cJSON_AddBoolToObject(audio, "xiaozhi_active", AudioService::Get().IsActive());
    cJSON_AddBoolToObject(audio, "voice_processing", AudioService::Get().IsVoiceProcessing());
    cJSON_AddItemToObject(root, "audio_speaker", audio);

    auto& board = Board::Get();
    if (auto* charge = board.charge()) {
        const auto snap         = charge->Get();
        cJSON*     battery      = cJSON_CreateObject();
        uint16_t   mv           = 0;
        uint8_t    pct          = 0;
        const bool have_battery = board.ReadBattery(&mv, &pct);
        cJSON_AddStringToObject(battery, "state", ChargeStateName(snap.state).c_str());
        cJSON_AddBoolToObject(battery, "power_present", snap.power_present);
        cJSON_AddBoolToObject(battery, "charging", snap.charging);
        cJSON_AddBoolToObject(battery, "full", snap.full);
        cJSON_AddBoolToObject(battery, "no_battery", snap.no_battery);
        if (have_battery) {
            cJSON_AddNumberToObject(battery, "voltage_mv", mv);
            cJSON_AddNumberToObject(battery, "level", pct);
        }
        cJSON_AddItemToObject(root, "battery", battery);
    }

    cJSON* network = cJSON_CreateObject();
    cJSON_AddStringToObject(network, "type", "wifi");
    cJSON_AddBoolToObject(network, "connected", Wifi::Get().IsConnected());
    if (Wifi::Get().IsConnected()) {
        cJSON_AddNumberToObject(network, "rssi", Wifi::Get().GetRssi());
        cJSON_AddStringToObject(network, "ip", Wifi::Get().GetIp().c_str());
    }
    cJSON_AddItemToObject(root, "network", network);

    const auto snap    = XiaozhiService::Get().Snapshot();
    cJSON*     xiaozhi = cJSON_CreateObject();
    cJSON_AddStringToObject(xiaozhi, "state", XiaozhiStateName(snap.state).c_str());
    cJSON_AddStringToObject(xiaozhi, "status", snap.status.c_str());
    cJSON_AddBoolToObject(xiaozhi, "has_protocol", snap.has_protocol);
    cJSON_AddNumberToObject(xiaozhi, "volume", vol::ToCodec(snap.volume));
    cJSON_AddNumberToObject(xiaozhi, "level", snap.volume);
    if (!snap.user_text.empty())
        cJSON_AddStringToObject(xiaozhi, "user_text", snap.user_text.c_str());
    if (!snap.assistant_text.empty())
        cJSON_AddStringToObject(xiaozhi, "assistant_text", snap.assistant_text.c_str());
    if (!snap.error.empty())
        cJSON_AddStringToObject(xiaozhi, "error", snap.error.c_str());
    cJSON_AddItemToObject(root, "xiaozhi", xiaozhi);

    return PrintAndDelete(root);
}

std::string TextResultJson(const std::string& text, bool is_error) {
    cJSON* result  = cJSON_CreateObject();
    cJSON* content = cJSON_CreateArray();
    cJSON* item    = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "type", "text");
    cJSON_AddStringToObject(item, "text", text.c_str());
    cJSON_AddItemToArray(content, item);
    cJSON_AddItemToObject(result, "content", content);
    cJSON_AddBoolToObject(result, "isError", is_error);
    return PrintAndDelete(result);
}

std::string OpenCardResult(const std::string& title, int position) {
    cache::CachedGroupSummary group;
    if (!cache::ReadCachedGroupSummary(group))
        return TextResultJson("当前设备没有已同步的内容组", true);
    std::string chosen;
    std::string positions;
    for (int i = 0; i < group.content_count; ++i) {
        if (position && position != i + 1)
            continue;
        cache::FrameMeta frame;
        if (!cache::ReadFrameMeta(group.gid, i, frame) || frame.content_id.empty() || frame.status_bar_text != title)
            continue;
        if (!positions.empty())
            positions += "、";
        positions += std::to_string(i + 1);
        if (!chosen.empty()) {
            // Keep collecting positions for a follow-up disambiguation.
            continue;
        }
        chosen = frame.content_id;
    }
    if (chosen.empty())
        return TextResultJson("当前内容组未找到标题为「" + title + "」的卡片", true);
    if (positions.find("、") != std::string::npos)
        return TextResultJson("有多张同名卡片，请指定位置：" + positions, true);
    cache::CachedGroupSummary latest;
    if (!cache::ReadCachedGroupSummary(latest) || latest.gid != group.gid ||
        latest.manifest_version != group.manifest_version)
        return TextResultJson("内容组正在更新，请重试", true);
    {
        std::lock_guard<std::mutex> lock(pending_card_mutex);
        pending_card = {group.gid, chosen, {}};
        if (recent_note.group_id == group.gid && recent_note.content_id == chosen)
            pending_card.image_hash = recent_note.image_hash;
    }
    XiaozhiService::Get().ReturnToCardAfterReply();
    return TextResultJson("已选中「" + title + "」，简短回应，播报后设备会自动显示。");
}

bool TakePendingCard(std::string& group_id, std::string& content_id) {
    CardTarget target;
    {
        std::lock_guard<std::mutex> lock(pending_card_mutex);
        target = std::exchange(pending_card, {});
    }
    if (target.content_id.empty() || !IsCardReady(target))
        return false;
    group_id = std::move(target.group_id);
    content_id = std::move(target.content_id);
    return true;
}

bool PendingCardReady() {
    CardTarget target;
    {
        std::lock_guard<std::mutex> lock(pending_card_mutex);
        target = pending_card;
    }
    return IsCardReady(target);
}

void ResetCardActions() {
    std::lock_guard<std::mutex> lock(pending_card_mutex);
    pending_card = {};
    recent_note = {};
}

std::string WriteMessageBoardResult(const std::string& message, const std::string& author, int position,
                                    bool open_after_save) {
    cache::CachedGroupSummary group;
    if (!cache::ReadCachedGroupSummary(group))
        return TextResultJson("当前设备没有已同步的内容组", true);
    cache::FrameMeta frame;
    if (position && (position > group.content_count || !cache::ReadFrameMeta(group.gid, position - 1, frame) ||
                     frame.content_id.empty() || frame.status_bar_text != "家庭留言板"))
        return TextResultJson("指定位置没有家庭留言板，请同步并核对位置", true);
    cache::CachedGroupSummary latest;
    if (!cache::ReadCachedGroupSummary(latest) || latest.gid != group.gid ||
        latest.manifest_version != group.manifest_version)
        return TextResultJson("内容组正在更新，请重试", true);
    std::string error;
    api::MessageBoardUpdate update;
    if (!api::DefaultClient().WriteMessageBoard(group.gid, frame.content_id, message, author, update, error))
        return TextResultJson(error, true);
    const bool wait_for_display = open_after_save && !update.image_hash.empty();
    {
        std::lock_guard<std::mutex> lock(pending_card_mutex);
        recent_note = {group.gid, std::move(update.content_id), std::move(update.image_hash)};
        if (wait_for_display)
            pending_card = recent_note;
    }
    SyncService::Get().RequestUserActiveSync();
    XiaozhiService::Get().ReturnToCardAfterReply();
    return TextResultJson(wait_for_display ? "留言已保存，正在更新画面，画面同步后打开留言板。" :
                          "留言已保存，待设备同步。");
}

std::string ToolListResultJson() {
    cJSON* result = cJSON_CreateObject();
    cJSON* tools  = cJSON_CreateArray();

    cJSON* status_tool = cJSON_CreateObject();
    cJSON_AddStringToObject(status_tool, "name", "self.get_device_status");
    cJSON_AddStringToObject(
        status_tool, "description",
        "Provides the real-time information of the device, including the current status of the audio speaker, screen, "
        "battery, network, etc.\n"
        "Use this tool for: \n"
        "1. Answering questions about current condition (e.g. what is the current volume of the audio speaker?)\n"
        "2. As the first step to control the device (e.g. turn up / down the volume of the audio speaker, etc.)");
    cJSON_AddItemToObject(status_tool, "inputSchema", MakeObjectSchema());
    cJSON_AddItemToArray(tools, status_tool);

    cJSON* volume_tool = cJSON_CreateObject();
    cJSON_AddStringToObject(volume_tool, "name", "self.audio_speaker.set_volume");
    cJSON_AddStringToObject(volume_tool, "description",
                            "Set the volume of the audio speaker. If the current volume is unknown, you must call "
                            "`self.get_device_status` tool first and then call this tool.");
    cJSON* volume_schema = cJSON_CreateObject();
    cJSON_AddStringToObject(volume_schema, "type", "object");
    cJSON* properties  = cJSON_CreateObject();
    cJSON* volume_prop = cJSON_CreateObject();
    cJSON_AddStringToObject(volume_prop, "type", "integer");
    cJSON_AddNumberToObject(volume_prop, "minimum", 0);
    cJSON_AddNumberToObject(volume_prop, "maximum", 100);
    cJSON_AddItemToObject(properties, "volume", volume_prop);
    cJSON_AddItemToObject(volume_schema, "properties", properties);
    cJSON* required = cJSON_CreateArray();
    cJSON_AddItemToArray(required, cJSON_CreateString("volume"));
    cJSON_AddItemToObject(volume_schema, "required", required);
    cJSON_AddItemToObject(volume_tool, "inputSchema", volume_schema);
    cJSON_AddItemToArray(tools, volume_tool);

    AddSlateTool(tools, "self.slate.open_card",
                 "按卡片标题打开当前 Slate 内容组中的卡片，播报后自动切到该卡。例如家庭留言板、正数日。"
                 "同名时询问用户卡片位置。", "title");
    cJSON* note = AddSlateTool(tools, "self.slate.write_message_board",
                              "仅在用户明确要求写留言时，用原话替换当前内容组家庭留言板的正文。"
                              "新留言持续显示。多张留言板时询问位置。", "message");
    cJSON* author = cJSON_AddObjectToObject(note, "author");
    cJSON_AddStringToObject(author, "type", "string");
    cJSON_AddStringToObject(author, "description", "用户指定的落款，可省略。");
    cJSON* open = cJSON_AddObjectToObject(note, "open_after_save");
    cJSON_AddStringToObject(open, "type", "boolean");
    cJSON_AddStringToObject(open, "description", "用户同时要求打开留言板或让新留言立即上屏时设为 true；默认 false。");

    cJSON_AddItemToObject(result, "tools", tools);
    return PrintAndDelete(result);
}

std::string JsonRpcResult(const std::string& id, const std::string& result) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "jsonrpc", "2.0");
    cJSON* parsed_id = cJSON_Parse(id.c_str());
    if (parsed_id) {
        cJSON_AddItemToObject(root, "id", parsed_id);
    } else {
        cJSON_AddStringToObject(root, "id", id.c_str());
    }
    cJSON_AddRawToObject(root, "result", result.c_str());
    return PrintAndDelete(root);
}

std::string JsonRpcError(const std::string& id, int code, const std::string& message) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "jsonrpc", "2.0");
    cJSON* parsed_id = cJSON_Parse(id.c_str());
    if (parsed_id) {
        cJSON_AddItemToObject(root, "id", parsed_id);
    } else {
        cJSON_AddStringToObject(root, "id", id.c_str());
    }
    cJSON* error = cJSON_CreateObject();
    cJSON_AddNumberToObject(error, "code", code);
    cJSON_AddStringToObject(error, "message", message.c_str());
    cJSON_AddItemToObject(root, "error", error);
    return PrintAndDelete(root);
}

}  // namespace xiaozhi::mcp

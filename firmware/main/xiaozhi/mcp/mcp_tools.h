#pragma once

#include <string>

namespace xiaozhi::mcp {

std::string BuildDeviceStatusJson();
std::string TextResultJson(const std::string& text, bool is_error = false);
std::string OpenCardResult(const std::string& title, int position);
std::string WriteMessageBoardResult(const std::string& message, const std::string& author, int position,
                                    bool open_after_save);
bool TakePendingCard(std::string& group_id, std::string& content_id);
bool PendingCardReady();
void ResetCardActions();
std::string ToolListResultJson();
std::string JsonRpcResult(const std::string& id, const std::string& result);
std::string JsonRpcError(const std::string& id, int code, const std::string& message);

}  // namespace xiaozhi::mcp

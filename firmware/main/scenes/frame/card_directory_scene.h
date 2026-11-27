#pragma once

#include <functional>
#include <memory>
#include <string>

#include "scenes/core/scene.h"

class MenuList;
class StatusBar;

class CardDirectoryScene : public Scene {
   public:
    using SelectCard = std::function<void(const std::string& group_id, const std::string& content_id)>;

    CardDirectoryScene(int current, SelectCard select);
    ~CardDirectoryScene() override;
    const char* Name() const override { return "card_directory"; }
    void OnEnter(SceneContext& ctx) override;
    void OnExit(SceneContext& ctx) override;
    void OnEvent(SceneContext& ctx, const UiEvent& event) override;
    lv_obj_t* Root() override { return root_; }

   private:
    int current_;
    SelectCard select_;
    lv_obj_t* root_ = nullptr;
    std::unique_ptr<StatusBar> status_bar_;
    std::unique_ptr<MenuList> menu_;
};

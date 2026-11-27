#include "scenes/frame/card_directory_scene.h"

#include <utility>
#include <vector>

#include "drivers/display/epd_ssd1683.h"
#include "events/ui_event.h"
#include "scenes/core/scene_stack.h"
#include "storage/cache/cache.h"
#include "ui/menu_list.h"
#include "ui/status_bar.h"

CardDirectoryScene::CardDirectoryScene(int current, SelectCard select)
    : current_(current), select_(std::move(select)) {
}

CardDirectoryScene::~CardDirectoryScene() = default;

void CardDirectoryScene::OnEnter(SceneContext& ctx) {
    cache::CachedGroupSummary group;
    cache::ReadCachedGroupSummary(group);
    std::vector<MenuList::Item> items;
    if (group.content_count > 0)
        items.reserve(group.content_count);
    int cursor = 0;
    for (int i = 0; i < group.content_count; ++i) {
        cache::FrameMeta frame;
        if (!cache::ReadFrameMeta(group.gid, i, frame) || frame.content_id.empty())
            continue;
        if (i == current_)
            cursor = static_cast<int>(items.size());
        const auto title = std::to_string(i + 1) + "  " +
                           (frame.status_bar_text.empty() ? "未命名卡片" : frame.status_bar_text);
        items.push_back({title, [this, stack = ctx.stack, gid = group.gid, id = std::move(frame.content_id)] {
                             select_(gid, id);
                             stack->RequestPop();
                         }});
    }
    if (items.empty())
        items.push_back({"当前组暂无卡片", [stack = ctx.stack] { stack->RequestPop(); }});

    if (!ctx.epd->Lock(2000))
        return;
    root_ = CreateFullscreenRoot();
    status_bar_ = std::make_unique<StatusBar>(root_);
    status_bar_->SetCaption("卡片目录");
    RefreshStatusBarFromSensors(ctx, *status_bar_);
    menu_ = std::make_unique<MenuList>(root_, std::move(items), cursor, "上/下 选择   确认 打开   长按确认 返回");
    lv_refr_now(nullptr);
    ctx.epd->Unlock();
    ctx.epd->RequestUrgentPartialRefresh();
}

void CardDirectoryScene::OnExit(SceneContext& ctx) {
    DestroyRoot(ctx, root_, [this] {
        menu_.reset();
        status_bar_.reset();
    });
}

void CardDirectoryScene::OnEvent(SceneContext& ctx, const UiEvent& event) {
    if (event.kind == UiEventKind::kButtonLong && event.u.button.btn == ButtonId::kEnter) {
        ctx.stack->RequestPop();
        return;
    }
    if (!menu_ || event.kind != UiEventKind::kButtonShort)
        return;
    if (event.u.button.btn == ButtonId::kEnter) {
        menu_->OnEnter();
    } else {
        SyncRender(ctx, [this, &ctx, &event] {
            RefreshStatusBarFromSensors(ctx, *status_bar_);
            if (event.u.button.btn == ButtonId::kUp)
                menu_->OnUp();
            else
                menu_->OnDown();
        });
    }
}

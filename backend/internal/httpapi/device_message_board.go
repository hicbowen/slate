package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"slate/internal/api"
	"slate/internal/dynamic"
	"slate/internal/store"
	"slate/internal/store/db"
)

func (a *API) writeDeviceMessageBoard(w http.ResponseWriter, r *http.Request) error {
	var req api.DeviceMessageBoardRequest
	if err := decodeJSON(r, 4<<10, &req); err != nil {
		return err
	}
	if err := checkProtocol(req.Protocol); err != nil {
		return err
	}
	if req.GroupID == "" {
		return badRequest("请选择当前内容组内的留言板")
	}
	raw, err := json.Marshal(api.DynamicConfig{Type: api.DynamicTypeMessageBoard, Message: req.Message, MessageAuthor: req.Author})
	if err != nil {
		return err
	}
	cfg, err := dynamic.NormalizeConfig(raw)
	if err != nil {
		return err
	}
	ctx := r.Context()
	device, err := a.Store.Q.GetDevice(ctx, deviceID(r))
	if err != nil {
		return err
	}
	if device.OwnerID == nil || device.GroupID == nil || *device.GroupID != req.GroupID {
		return fail(403, "设备未绑定或当前内容组已变化，请同步后重试")
	}
	contents, err := a.Store.Q.ListContents(ctx, req.GroupID)
	if err != nil {
		return err
	}
	var contentID string
	var matches []string
	for i, item := range contents {
		if item.DynamicType == nil || *item.DynamicType != string(api.DynamicTypeMessageBoard) ||
			(req.ContentID != "" && req.ContentID != item.ID) {
			continue
		}
		contentID = item.ID
		matches = append(matches, strconv.Itoa(i+1))
	}
	switch len(matches) {
	case 0:
		return notFound("当前内容组里的家庭留言板")
	case 1:
	default:
		return fail(409, "找到多张家庭留言板，请指定卡片位置：%s", strings.Join(matches, "、"))
	}

	result := api.DeviceMessageBoardResponse{ContentID: contentID}
	err = a.Dynamic.Mutate(ctx, contentID, func() error {
		frame, err := a.Dynamic.Prepare(ctx, cfg, nil, nil, time.Now())
		if err != nil {
			return err
		}
		imageHash, colorHash, err := a.Blobs.PutFrames(frame.Image, frame.ColorImage)
		if err != nil {
			return err
		}
		result.ImageHash = imageHash
		result.ColorImageHash = *colorHash
		config, err := json.Marshal(cfg)
		if err != nil {
			return err
		}
		return a.Store.Tx(ctx, func(q *db.Queries) error {
			if _, err := q.LockGroup(ctx, req.GroupID); err != nil {
				if store.Missing(err) {
					return notFound("当前内容组")
				}
				return err
			}
			locked, err := q.LockOwnedDevice(ctx, db.LockOwnedDeviceParams{ID: device.ID, OwnerID: device.OwnerID})
			if store.Missing(err) || (err == nil && (locked.GroupID == nil || *locked.GroupID != req.GroupID)) {
				return fail(409, "设备绑定或当前内容组已变化，请同步后重试")
			}
			if err != nil {
				return err
			}
			current, err := q.GetContent(ctx, contentID)
			if store.Missing(err) || (err == nil && (current.OwnerID != *device.OwnerID || current.GroupID != req.GroupID ||
				current.DynamicType == nil || *current.DynamicType != string(api.DynamicTypeMessageBoard))) {
				return notFound("当前内容组里的家庭留言板")
			}
			if err != nil {
				return err
			}
			if err := q.UpdateDynamicConfig(ctx, db.UpdateDynamicConfigParams{ContentID: contentID, Config: config}); err != nil {
				return err
			}
			if err := q.SetContentImage(ctx, db.SetContentImageParams{ID: contentID, ImageHash: imageHash, ColorImageHash: colorHash}); err != nil {
				return err
			}
			return q.SaveDynamicRender(ctx, frame.SaveParams(contentID))
		})
	})
	if err != nil {
		return err
	}
	a.Dynamic.Wake()
	return ok(w, result)
}

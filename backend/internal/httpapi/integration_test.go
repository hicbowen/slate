package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"slate/internal/api"
	"slate/internal/blob"
	"slate/internal/config"
	"slate/internal/dynamic"
	"slate/internal/media"
	"slate/internal/store"
	"slate/internal/testdb"
)

type harness struct {
	t   *testing.T
	srv *httptest.Server
	st  *store.Store
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()
	cfg := config.Config{
		JWTSecret:     "integration-test-secret-0123456789abcdefghijklmnopqrstuvwxyz",
		JWTExpiration: time.Hour,
		BlobDir:       t.TempDir(),
		PublicDir:     t.TempDir(),
	}
	st, err := store.Open(ctx, testdb.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Pool.Close)
	blobs, err := blob.Open(cfg.BlobDir)
	if err != nil {
		t.Fatal(err)
	}
	m := media.New()
	engine, err := dynamic.New(cfg, st, blobs, m)
	if err != nil {
		t.Fatal(err)
	}
	a := &API{Config: cfg, Store: st, Blobs: blobs, Dynamic: engine, Media: m}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	return &harness{t, srv, st}
}

// call sends a request and decodes the envelope's data into out (when non-nil).
func (h *harness) call(method, path, token string, body any, out any, headers ...http.Header) int {
	h.t.Helper()
	var r io.Reader
	contentType := ""
	switch b := body.(type) {
	case nil:
	case multipartBody:
		r, contentType = b.buf, b.contentType
	default:
		raw, _ := json.Marshal(b)
		r, contentType = bytes.NewReader(raw), "application/json"
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, r)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for _, header := range headers {
		for name, values := range header {
			for _, value := range values {
				req.Header.Add(name, value)
			}
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if out != nil && res.StatusCode < 300 {
		if b, ok := out.(*[]byte); ok {
			*b = raw
			return res.StatusCode
		}
		var env struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			h.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
		if err := json.Unmarshal(env.Data, out); err != nil {
			h.t.Fatalf("%s %s: %v: %s", method, path, err, env.Data)
		}
	}
	return res.StatusCode
}

func (h *harness) must(want int, got int, what string) {
	h.t.Helper()
	if got != want {
		h.t.Fatalf("%s: status %d, want %d", what, got, want)
	}
}

type multipartBody struct {
	buf         *bytes.Buffer
	contentType string
}

func frameUpload(frame []byte, frameName string) multipartBody {
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	part, _ := w.CreateFormFile("frame", "frame.bin")
	_, _ = part.Write(frame)
	_ = w.WriteField("frameName", frameName)
	_ = w.Close()
	return multipartBody{buf, w.FormDataContentType()}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *harness) user(name string) string {
	h.t.Helper()
	var s api.Session
	h.must(201, h.call("POST", "/api/users", "", map[string]string{"email": name + "@example.com", "username": name, "password": "integration-pass-1"}, &s), "register "+name)
	return s.Token
}

func (h *harness) group(token, name string) string {
	h.t.Helper()
	var g struct{ ID string }
	h.must(201, h.call("POST", "/api/groups", token, map[string]string{"name": name}, &g), "create group")
	return g.ID
}

func (h *harness) device(mac string) api.DeviceRegisterResponse {
	h.t.Helper()
	var d api.DeviceRegisterResponse
	h.must(200, h.call("POST", "/api/device/register", "", api.DeviceRegisterRequest{Protocol: api.DeviceProtocol, MAC: mac}, &d), "register device")
	return d
}

func TestDeviceProtocol(t *testing.T) {
	h := newHarness(t)
	token := h.user("alice")
	gid := h.group(token, "相册")
	frame := make([]byte, api.FrameBytes)
	_, _ = rand.Read(frame)
	h.must(201, h.call("POST", "/api/groups/"+gid+"/contents", token, frameUpload(frame, "第一帧"), nil), "upload frame")

	dev := h.device("AA:BB:CC:DD:EE:01")
	var state api.DeviceState
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol}, &state), "unbound sync")
	if state.Device.Bound || state.Group != nil || state.Manifest != nil {
		t.Fatalf("unbound device got group or manifest: %+v", state)
	}

	h.must(200, h.call("POST", "/api/devices/claims", token, map[string]string{"pairCode": dev.PairCode}, nil), "claim")
	h.must(200, h.call("PATCH", "/api/devices/"+dev.DeviceID, token, map[string]any{"groupId": gid}, nil), "select group")

	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol}, &state), "bound sync")
	if state.Manifest == nil || len(state.Manifest.Frames) != 1 || state.Manifest.Version != state.Group.ManifestVersion {
		t.Fatalf("bound sync manifest: %+v", state)
	}
	version := state.Group.ManifestVersion
	deviceURL := "/api/devices/" + dev.DeviceID
	groupURL := "/api/groups/" + gid
	h.must(400, h.call("PATCH", groupURL, token, map[string]int{"rotationMinutes": 12}, nil), "reject unsupported rotation")
	h.must(200, h.call("PATCH", groupURL, token, map[string]int{"rotationMinutes": 30}, nil), "enable insertion rotation")
	var view api.Device
	h.must(200, h.call("GET", deviceURL, token, nil, &view), "legacy device view")
	if view.SyncStatus != nil {
		t.Fatalf("legacy client has diagnostics: %+v", view.SyncStatus)
	}
	report := "/api/device/sync?diag=1&syncResult=cache_full&screenVersion=" + version + "&nextRefreshAt=1900000000"
	var cached api.DeviceState
	h.must(200, h.call("POST", report, dev.Secret, api.DeviceSyncRequest{
		Protocol: api.DeviceProtocol, ManifestVersion: version,
	}, &cached), "diagnostic sync with cached frames")
	if cached.Manifest != nil || cached.Group.RotationMinutes != 30 {
		t.Fatalf("rotation update requires cached metadata only: %+v", cached)
	}
	h.must(200, h.call("GET", deviceURL, token, nil, &view), "diagnostic device view")
	if st := view.SyncStatus; st == nil || st.AppliedVersion != version || st.ScreenVersion != version ||
		st.ExpectedVersion != version || st.LastResult != "cache_full" || st.NextRefreshAt != 1900000000 {
		t.Fatalf("sync diagnostics: %+v", st)
	}
	f := state.Manifest.Frames[0]
	if f.Image.Hash != blob.Hash(frame) || f.Image.Size != api.FrameBytes || f.StatusBarText == "" || f.RefreshAt != nil {
		t.Fatalf("frame: %+v", f)
	}

	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol, ManifestVersion: state.Manifest.Version}, &state), "cached sync")
	if state.Manifest != nil {
		t.Fatal("manifest resent for an up-to-date version")
	}

	var got []byte
	h.must(200, h.call("GET", "/api/device/blobs/"+f.Image.Hash, dev.Secret, nil, &got), "download blob")
	if !bytes.Equal(got, frame) {
		t.Fatal("blob bytes differ from the upload")
	}

	h.must(426, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol - 1}, nil), "old protocol")
	h.must(401, h.call("POST", "/api/device/sync", randomHex(32), api.DeviceSyncRequest{Protocol: api.DeviceProtocol}, nil), "unknown secret")
}

func TestDashboardPushToken(t *testing.T) {
	h := newHarness(t)
	owner := h.user("dashboard_owner")
	other := h.user("dashboard_other")
	gid := h.group(owner, "仪表盘")
	var content api.Content
	payload := map[string]any{"version": 1, "data": map[string]any{"value": 1}}
	h.must(201, h.call("POST", "/api/groups/"+gid+"/contents", owner, api.CreateDynamicContentRequest{
		Config:      json.RawMessage(`{"type":"dashboard","template":{"kind":"system","id":"ai_quota_monitor"}}`),
		InitialData: json.RawMessage(`{"value":1}`),
	}, &content), "create dashboard")
	if content.Dynamic == nil || content.Dynamic.PushAuth != "unconfigured" {
		t.Fatalf("new dashboard push auth: %+v", content.Dynamic)
	}
	path := "/api/contents/" + content.ID + "/data"
	h.must(401, h.call("POST", path, "", payload, nil), "new dashboard requires token")
	h.must(404, h.call("POST", path+"/token", other, nil, nil), "only owner may rotate token")
	if _, err := h.st.Pool.Exec(context.Background(), "UPDATE content_dynamic SET push_token_hash = NULL WHERE content_id = $1", content.ID); err != nil {
		t.Fatal(err)
	}
	h.must(200, h.call("POST", path, "", payload, nil), "legacy dashboard accepts original URL")
	var first, second api.DashboardPushToken
	h.must(200, h.call("POST", path+"/token", owner, nil, &first), "enable token")
	h.must(401, h.call("POST", path, "", payload, nil), "migration disables the legacy URL")
	h.must(200, h.call("POST", path, first.Token, payload, nil), "accept enabled token")
	h.must(200, h.call("POST", path+"/token", owner, nil, &second), "rotate token")
	h.must(401, h.call("POST", path, first.Token, payload, nil), "previous token revoked")
	h.must(200, h.call("POST", path, second.Token, payload, nil), "accept rotated token")
}

func TestImageUploadRetryReusesContent(t *testing.T) {
	h := newHarness(t)
	token := h.user("batch_upload")
	gid := h.group(token, "照片")
	other := h.group(token, "另一组")
	key := http.Header{"Idempotency-Key": []string{"0123456789abcdef0123456789abcdef"}}
	var first, retry, otherGroup api.Content
	frame := make([]byte, api.FrameBytes)
	path := "/api/groups/" + gid + "/contents"
	h.must(201, h.call("POST", path, token, frameUpload(frame, "照片"), &first, key), "batch upload")
	h.must(200, h.call("POST", path, token, frameUpload(frame, "照片"), &retry, key), "retry same upload")
	h.must(201, h.call("POST", "/api/groups/"+other+"/contents", token, frameUpload(frame, "照片"), &otherGroup, key), "key scoped to group")
	if first.ID != retry.ID || first.ID == otherGroup.ID {
		t.Fatalf("wrong retry scope: first=%s retry=%s other=%s", first.ID, retry.ID, otherGroup.ID)
	}
	var contents []api.Content
	h.must(200, h.call("GET", path, token, nil, &contents), "list group")
	if len(contents) != 1 {
		t.Fatalf("upload retry created a duplicate: %d items", len(contents))
	}
}

func TestDeviceColorRenditions(t *testing.T) {
	h := newHarness(t)
	token := h.user("color")
	gid := h.group(token, "双色组")
	uploadURL := "/api/groups/" + gid + "/contents"
	mono := bytes.Repeat([]byte{0xa5}, api.FrameBytes)
	color := bytes.Repeat([]byte{0x1b}, api.ColorFrameBytes)

	var legacy, both api.Content
	h.must(201, h.call("POST", uploadURL, token, frameUpload(mono, "旧图"), &legacy), "legacy upload")
	buf := &bytes.Buffer{}
	form := multipart.NewWriter(buf)
	for field, data := range map[string][]byte{"frame": mono, "colorFrame": color} {
		file, _ := form.CreateFormFile(field, field+".bin")
		_, _ = file.Write(data)
	}
	_ = form.Close()
	h.must(201, h.call("POST", uploadURL, token, multipartBody{buf, form.FormDataContentType()}, &both), "dual upload")
	colorHash := blob.Hash(color)
	if both.ColorImageHash == nil || *both.ColorImageHash != colorHash {
		t.Fatalf("saved color rendition: %+v", both.ColorImageHash)
	}

	dev := h.device("AA:BB:CC:DD:EE:04")
	url := "/api/device/blobs/" + colorHash
	h.must(404, h.call("GET", url, dev.Secret, nil, nil), "unbound blob access")
	h.must(200, h.call("POST", "/api/devices/claims", token, map[string]string{"pairCode": dev.PairCode}, nil), "claim")

	var note4, note4c api.DeviceState
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol}, &note4), "mono sync")
	h.must(200, h.call("POST", "/api/device/group", dev.Secret, api.DeviceGroupRequest{
		Protocol: api.DeviceProtocol, Action: "select", GroupID: gid, FrameFormat: api.ColorFrameFormat,
		ManifestVersion: note4.Group.ManifestVersion,
	}, &note4c), "color select")
	if note4.Manifest.Frames[1].Image.Hash != both.ImageHash || note4c.Manifest.Version == note4.Manifest.Version {
		t.Fatalf("manifest selection: mono %+v, color %+v", note4.Manifest, note4c.Manifest)
	}
	if f := note4c.Manifest.Frames[0]; f.ID != legacy.ID || f.Image.Size != api.FrameBytes || f.Image.Hash != legacy.ImageHash {
		t.Fatalf("legacy fallback: %+v", f)
	}
	if f := note4c.Manifest.Frames[1]; f.Image.Size != api.ColorFrameBytes || f.Image.Hash != colorHash {
		t.Fatalf("color selection: %+v", f)
	}
	var got []byte
	h.must(200, h.call("GET", url, dev.Secret, nil, &got), "device color download")
	if !bytes.Equal(got, color) {
		t.Fatal("downloaded color frame differs from upload")
	}
	h.must(200, h.call("GET", "/api/blobs/"+colorHash, token, nil, &got), "Web color preview blob")
	req := api.DeviceSyncRequest{Protocol: api.DeviceProtocol, FrameFormat: api.ColorFrameFormat, ManifestVersion: note4c.Manifest.Version}
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, req, &note4c), "cached color sync")
	if note4c.Manifest != nil {
		t.Fatal("manifest resent for unchanged color frames")
	}

	path := "/api/contents/" + both.ID
	both = api.Content{}
	h.must(200, h.call("PATCH", path, token, frameUpload(mono, "黑白更新"), &both), "replace with mono-only upload")
	if both.ColorImageHash != nil {
		t.Fatal("old color frame survived an image replacement")
	}
	h.must(404, h.call("GET", url, dev.Secret, nil, nil), "removed color blob access")
}

func TestEditableImageSource(t *testing.T) {
	h := newHarness(t)
	owner := h.user("sourceowner")
	gid := h.group(owner, "原图测试")
	uploadURL := "/api/groups/" + gid + "/contents"
	frame := bytes.Repeat([]byte{0xff}, api.FrameBytes)
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewGray(image.Rect(0, 0, api.FrameWidth, api.FrameHeight))); err != nil {
		t.Fatal(err)
	}
	upload := func(image []byte, preset string, extras ...map[string]string) multipartBody {
		t.Helper()
		buf := &bytes.Buffer{}
		writer := multipart.NewWriter(buf)
		for field, data := range map[string][]byte{"frame": frame, "imageSource": image} {
			part, err := writer.CreateFormFile(field, field)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.WriteField("imageRenderPreset", preset); err != nil {
			t.Fatal(err)
		}
		for _, fields := range extras {
			for field, value := range fields {
				if err := writer.WriteField(field, value); err != nil {
					t.Fatal(err)
				}
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return multipartBody{buf, writer.FormDataContentType()}
	}
	h.must(400, h.call("POST", uploadURL, owner, upload([]byte("not a PNG"), "photo"), nil), "invalid source")
	h.must(400, h.call("POST", uploadURL, owner, upload(source.Bytes(), "unknown"), nil), "invalid preset")
	var saved api.Content
	h.must(201, h.call("POST", uploadURL, owner, upload(source.Bytes(), "photo"), &saved), "save source")
	hash := blob.Hash(source.Bytes())
	if saved.ImageSourceHash == nil || *saved.ImageSourceHash != hash || saved.ImageRenderPreset != "photo" {
		t.Fatalf("source metadata: %+v", saved)
	}
	path := "/api/contents/" + saved.ID
	var downloaded []byte
	h.must(200, h.call("GET", "/api/blobs/"+hash, owner, nil, &downloaded), "owner source download")
	if !bytes.Equal(downloaded, source.Bytes()) {
		t.Fatal("downloaded source differs from uploaded PNG")
	}
	h.must(404, h.call("GET", "/api/blobs/"+hash, h.user("sourceguest"), nil, nil), "deny other user source download")
	device := h.device("AA:BB:CC:DD:EE:08")
	h.must(200, h.call("POST", "/api/devices/claims", owner, map[string]string{"pairCode": device.PairCode}, nil), "claim")
	h.must(404, h.call("GET", "/api/device/blobs/"+hash, device.Secret, nil, nil), "deny device source download")
	hashes, err := h.st.Q.ReferencedBlobHashes(t.Context())
	if err != nil || !slices.Contains(hashes, hash) {
		t.Fatalf("GC source reference: %v, %v", hashes, err)
	}
	var updated api.Content
	h.must(200, h.call("PATCH", path, owner, upload(source.Bytes(), "graphic"), &updated), "rerender saved source")
	if updated.ImageSourceHash == nil || *updated.ImageSourceHash != hash || updated.ImageRenderPreset != "graphic" {
		t.Fatalf("updated source metadata: %+v", updated)
	}
	updated = api.Content{}
	h.must(200, h.call("PATCH", path, owner, frameUpload(frame, "旧客户端更新"), &updated), "replace without source")
	if updated.ImageSourceHash != nil || updated.ImageRenderPreset != "auto" {
		t.Fatalf("stale source after replacement: %+v", updated)
	}
	h.must(404, h.call("GET", "/api/blobs/"+hash, owner, nil, nil), "removed source download")
	var original bytes.Buffer
	if err := png.Encode(&original, image.NewGray(image.Rect(0, 0, 900, 500))); err != nil {
		t.Fatal(err)
	}
	originalHash := blob.Hash(original.Bytes())
	crop := `{"fit":"cover","scale":1.5,"x":19,"y":0,"dither":"threshold","threshold":145}`
	h.must(400, h.call("POST", uploadURL, owner, upload(source.Bytes(), "photo", map[string]string{
		"imageOriginal": original.String(),
	}), nil), "reject original without crop")
	var kept api.Content
	h.must(201, h.call("POST", uploadURL, owner, upload(source.Bytes(), "photo", map[string]string{
		"imageOriginal": original.String(), "imageCrop": crop,
	}), &kept), "keep original")
	originalPath := "/api/blobs/" + originalHash
	if kept.ImageOriginalHash == nil || *kept.ImageOriginalHash != originalHash {
		t.Fatalf("wrong original hash: %+v", kept.ImageOriginalHash)
	}
	h.must(200, h.call("GET", originalPath, owner, nil, &downloaded), "owner original bytes")
	if !bytes.Equal(downloaded, original.Bytes()) {
		t.Fatal("original bytes changed")
	}
	h.must(404, h.call("GET", originalPath, h.user("originalguest"), nil, nil), "deny other user original")
	h.must(404, h.call("GET", "/api/device/blobs/"+originalHash, device.Secret, nil, nil), "deny device original")
	hashes, err = h.st.Q.ReferencedBlobHashes(t.Context())
	if err != nil || !slices.Contains(hashes, originalHash) {
		t.Fatalf("original GC reference missing: %v", err)
	}
	keptPath := "/api/contents/" + kept.ID
	h.must(409, h.call("PATCH", keptPath, owner, upload(source.Bytes(), "graphic", map[string]string{
		"reuseImageOriginal": hash, "imageCrop": crop,
	}), nil), "do not attach stale or different original")
	crop = strings.Replace(crop, "1.5", "2", 1)
	kept = api.Content{}
	h.must(200, h.call("PATCH", keptPath, owner, upload(source.Bytes(), "graphic", map[string]string{
		"reuseImageOriginal": originalHash, "imageCrop": crop,
	}), &kept), "recrop without reuploading original")
	var restored api.ImageCrop
	if err := json.Unmarshal(kept.ImageCrop, &restored); err != nil || restored.Scale != 2 || restored.Threshold != 145 {
		t.Fatalf("saved crop: %+v, %v", restored, err)
	}
	buf := &bytes.Buffer{}
	form := multipart.NewWriter(buf)
	_ = form.WriteField("removeImageOriginal", "true")
	_ = form.Close()
	kept = api.Content{}
	h.must(200, h.call("PATCH", keptPath, owner, multipartBody{buf, form.FormDataContentType()}, &kept), "remove only original")
	if kept.ImageOriginalHash != nil || len(kept.ImageCrop) != 0 || kept.ImageSourceHash == nil {
		t.Fatalf("unexpected fields after removal: %+v", kept)
	}
	h.must(404, h.call("GET", originalPath, owner, nil, nil), "removed original no longer visible")

}

func TestNote4GrayRendition(t *testing.T) {
	h := newHarness(t)
	token := h.user("gray")
	gid := h.group(token, "灰阶相册")
	uploadURL := "/api/groups/" + gid + "/contents"
	mono := bytes.Repeat([]byte{0xa5}, api.FrameBytes)
	gray := bytes.Repeat([]byte{0x17, 0x8f}, api.GrayFrameBytes/2)
	color := bytes.Repeat([]byte{0x1b}, api.ColorFrameBytes)
	multipart := func(mode string, frames map[string][]byte) multipartBody {
		buf := &bytes.Buffer{}
		form := multipart.NewWriter(buf)
		for field, data := range frames {
			file, _ := form.CreateFormFile(field, field+".bin")
			_, _ = file.Write(data)
		}
		if mode != "" {
			_ = form.WriteField("displayMode", mode)
		}
		_ = form.Close()
		return multipartBody{buf, form.FormDataContentType()}
	}
	h.must(400, h.call("POST", uploadURL, token, multipart(api.DisplayModeGray, map[string][]byte{"frame": mono}), nil), "gray mode without a gray frame")
	h.must(400, h.call("POST", uploadURL, token, multipart("", map[string][]byte{"frame": mono, "grayFrame": gray[:100]}), nil), "invalid gray size")
	var legacy, image, dyn api.Content
	h.must(201, h.call("POST", uploadURL, token, frameUpload(mono, "旧图"), &legacy), "old black and white")
	h.must(201, h.call("POST", uploadURL, token, multipart(api.DisplayModeGray, map[string][]byte{"frame": mono, "grayFrame": gray, "colorFrame": color}), &image), "gray upload")
	h.must(201, h.call("POST", uploadURL, token, api.CreateDynamicContentRequest{
		Config: json.RawMessage(`{"type":"font_test","fontId":"fusion_pixel_12"}`),
	}, &dyn), "dynamic frame")
	grayHash := blob.Hash(gray)
	if image.DisplayMode != api.DisplayModeGray || image.GrayImageHash == nil || *image.GrayImageHash != grayHash {
		t.Fatalf("saved grayscale frame: %+v", image)
	}
	groupURL := "/api/groups/" + gid
	var group api.Group
	h.must(200, h.call("GET", groupURL, token, nil, &group), "group cache estimate")
	if group.TotalBytes != 3*api.FrameBytes || group.Note4ImageBytes != 2*api.FrameBytes+api.GrayFrameBytes ||
		group.Note4CImageBytes != api.FrameBytes+2*api.ColorFrameBytes || group.AudioBytes != 0 {
		t.Fatalf("group cache estimate: %+v", group)
	}
	dev := h.device("AA:BB:CC:DD:EE:05")
	h.must(200, h.call("POST", "/api/devices/claims", token, map[string]string{"pairCode": dev.PairCode}, nil), "claim")
	var state api.DeviceState
	req := api.DeviceSyncRequest{Protocol: api.DeviceProtocol}
	graySync := "/api/device/sync?frameFormat=gray4"
	h.must(200, h.call("POST", graySync, dev.Secret, req, &state), "Note4 gray sync")
	frames := state.Manifest.Frames
	if frames[0].Image.Size != api.FrameBytes || frames[2].Image.Size != api.FrameBytes ||
		frames[1].Image.Size != api.GrayFrameBytes || frames[1].Image.Hash != grayHash {
		t.Fatalf("mixed manifest frames: %+v", frames)
	}
	grayVersion := state.Manifest.Version
	req.ManifestVersion = grayVersion
	h.must(200, h.call("POST", graySync, dev.Secret, req, &state), "cached grayscale sync")
	if state.Manifest != nil {
		t.Fatal("manifest resent for unchanged grayscale frames")
	}
	var got []byte
	h.must(200, h.call("GET", "/api/device/blobs/"+grayHash, dev.Secret, nil, &got), "get grayscale blob")
	if !bytes.Equal(got, gray) {
		t.Fatal("gray blob bytes differ from uploaded frame")
	}
	h.must(200, h.call("POST", "/api/device/group?frameFormat=gray4", dev.Secret, api.DeviceGroupRequest{
		Protocol: api.DeviceProtocol, Action: "select", GroupID: gid,
	}, &state), "group switch requests grayscale")
	if state.Manifest.Frames[1].Image.Hash != grayHash {
		t.Fatal("the group endpoint did not select the grayscale rendition")
	}
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, req, &state), "old Note4 sync")
	if state.Manifest.Frames[1].Image.Size != api.FrameBytes {
		t.Fatal("an old client received gray4")
	}
	req.FrameFormat = api.ColorFrameFormat
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, req, &state), "Note4C sync")
	if state.Manifest.Frames[1].Image.Hash != blob.Hash(color) {
		t.Fatal("the Note4 grayscale setting overrode Note4C color")
	}
	path := "/api/contents/" + image.ID
	h.must(400, h.call("PATCH", "/api/contents/"+legacy.ID, token, multipart(api.DisplayModeGray, nil), nil), "reject enabling gray on old asset")
	h.must(200, h.call("PATCH", path, token, multipart(api.DisplayModeMono, nil), &image), "switch to mono without reupload")
	if image.DisplayMode != api.DisplayModeMono || image.GrayImageHash == nil || *image.GrayImageHash != grayHash {
		t.Fatal("mode change lost the grayscale asset")
	}
	h.must(200, h.call("GET", groupURL, token, nil, &group), "group cache estimate after mode change")
	if group.Note4ImageBytes != 3*api.FrameBytes || group.Note4CImageBytes != api.FrameBytes+2*api.ColorFrameBytes {
		t.Fatalf("group cache estimate after mode change: %+v", group)
	}
	req.FrameFormat = ""
	h.must(200, h.call("POST", graySync, dev.Secret, req, &state), "mode change invalidates grayscale manifest")
	if state.Manifest.Version == grayVersion || state.Manifest.Frames[1].Image.Hash != image.ImageHash {
		t.Fatal("mode change did not select the mono frame")
	}
	h.must(200, h.call("PATCH", path, token, multipart(api.DisplayModeGray, nil), nil), "switch back to gray")
	h.must(200, h.call("PATCH", path, token, frameUpload(mono, "旧客户端替换"), nil), "replace image without gray")
	h.must(404, h.call("GET", "/api/device/blobs/"+grayHash, dev.Secret, nil, nil), "removed grayscale asset")
}

func TestDeviceCanOnlyWriteItsSelectedMessageBoard(t *testing.T) {
	h := newHarness(t)
	token := h.user("voice_owner")
	gid := h.group(token, "当前组")
	other := h.group(token, "其他组")
	dev := h.device("AA:BB:CC:DD:EE:71")
	const path = "/api/device/message-board"
	req := api.DeviceMessageBoardRequest{Protocol: api.DeviceProtocol, GroupID: gid, Message: "今晚一起吃饭", Author: "妈妈"}
	h.must(403, h.call("POST", path, dev.Secret, req, nil), "unbound device")
	h.must(200, h.call("POST", "/api/devices/claims", token, map[string]string{"pairCode": dev.PairCode}, nil), "claim device")
	h.must(200, h.call("POST", "/api/device/group", dev.Secret, api.DeviceGroupRequest{Protocol: api.DeviceProtocol, Action: "select", GroupID: gid}, nil), "select group")

	create := func(groupID string) api.Content {
		t.Helper()
		var content api.Content
		config := json.RawMessage(`{"type":"message_board","message":"旧留言","messageExpiresAt":"2000-01-01T00:00:00Z","messageFallback":"旧备用文案"}`)
		h.must(201, h.call("POST", "/api/groups/"+groupID+"/contents", token, api.CreateDynamicContentRequest{Config: config}, &content), "create board")
		return content
	}
	board := create(gid)
	foreign := create(other)
	blocked := req
	blocked.GroupID, blocked.ContentID = other, foreign.ID
	h.must(403, h.call("POST", path, dev.Secret, blocked, nil), "deny non-selected group")
	blocked.GroupID = gid
	h.must(404, h.call("POST", path, dev.Secret, blocked, nil), "deny board outside selected group")
	create(gid)
	h.must(409, h.call("POST", path, dev.Secret, req, nil), "ambiguous boards")
	req.ContentID = board.ID
	var res api.DeviceMessageBoardResponse
	h.must(200, h.call("POST", path, dev.Secret, req, &res), "write selected board")
	if res.ContentID != board.ID {
		t.Fatalf("wrong board: %+v", res)
	}
	var refreshed api.Content
	h.must(200, h.call("GET", "/api/contents/"+board.ID, token, nil, &refreshed), "get saved board")
	if res.ImageHash != refreshed.ImageHash || refreshed.ColorImageHash == nil ||
		res.ColorImageHash != *refreshed.ColorImageHash {
		t.Fatalf("voice action received stale frame hashes: %+v", res)
	}
	var cfg api.DynamicConfig
	if err := json.Unmarshal(refreshed.Dynamic.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Message != req.Message || cfg.MessageAuthor != req.Author || cfg.MessageExpiresAt != "" ||
		refreshed.Dynamic.NextRunAt != nil || refreshed.ImageHash == board.ImageHash {
		t.Fatalf("unexpected saved board: %+v", refreshed)
	}
	var state api.DeviceState
	h.must(200, h.call("POST", "/api/device/sync", dev.Secret, api.DeviceSyncRequest{Protocol: api.DeviceProtocol}, &state), "sync voice changes")
	if state.Manifest == nil || len(state.Manifest.Frames) != 2 || state.Manifest.Frames[0].ID != board.ID ||
		state.Manifest.Frames[0].Image.Hash != refreshed.ImageHash {
		t.Fatalf("unexpected synced manifest: %+v", state.Manifest)
	}
}

func TestCountdownColorPreviewAndRefresh(t *testing.T) {
	h := newHarness(t)
	token := h.user("countdown")
	gid := h.group(token, "倒数日")
	cfg := json.RawMessage(`{"type":"countdown","tz":"Asia/Shanghai","goal":"开学","targetDate":"2000-09-01"}`)
	var preview []byte
	h.must(200, h.call("POST", "/api/contents/preview?format=bwry2", token, api.PreviewDynamicRequest{Config: cfg}, &preview), "color preview")
	if len(preview) != api.ColorFrameBytes {
		t.Fatalf("preview size: %d", len(preview))
	}

	var content api.Content
	h.must(201, h.call("POST", "/api/groups/"+gid+"/contents", token, api.CreateDynamicContentRequest{Config: cfg}, &content), "create countdown")
	if content.ColorImageHash == nil || *content.ColorImageHash != blob.Hash(preview) || content.Dynamic.NextRunAt == nil {
		t.Fatalf("saved countdown: %+v", content)
	}
	h.must(200, h.call("POST", "/api/contents/"+content.ID+"/refresh", token, nil, &content), "refresh countdown")
	if content.ColorImageHash == nil || *content.ColorImageHash != blob.Hash(preview) {
		t.Fatal("refresh lost the color rendition")
	}

	hashes := map[string]bool{blob.Hash(preview): true}
	for _, layout := range []api.CountdownLayout{api.CountdownLayoutEditorial, api.CountdownLayoutPoster, api.CountdownLayoutSplit} {
		changed, _ := json.Marshal(api.DynamicConfig{
			Type: api.DynamicTypeCountdown, TZ: "Asia/Shanghai", Goal: "开学", TargetDate: "2000-09-01", CountdownLayout: layout,
		})
		h.must(200, h.call("POST", "/api/contents/preview?format=bwry2", token, api.PreviewDynamicRequest{Config: changed}, &preview), "layout preview")
		hash := blob.Hash(preview)
		if hashes[hash] {
			t.Fatalf("layout %q reused another layout's image", layout)
		}
		hashes[hash] = true

		h.must(200, h.call("PATCH", "/api/contents/"+content.ID, token, map[string]json.RawMessage{"config": changed}, &content), "update layout")
		h.must(200, h.call("POST", "/api/contents/"+content.ID+"/refresh", token, nil, &content), "refresh layout")
		var saved api.DynamicConfig
		if err := json.Unmarshal(content.Dynamic.Config, &saved); err != nil {
			t.Fatal(err)
		}
		if saved.CountdownLayout != layout || content.ColorImageHash == nil || *content.ColorImageHash != hash {
			t.Fatalf("layout %q did not persist through refresh: %+v", layout, content)
		}
	}

	invalid := json.RawMessage(`{"type":"countdown","goal":"开学","targetDate":"2000-09-01","countdownLayout":"unknown"}`)
	h.must(400, h.call("PATCH", "/api/contents/"+content.ID, token, map[string]json.RawMessage{"config": invalid}, nil), "reject unknown layout")
}

// Concurrent group switches must each step from the previous result, not from a stale read.
func TestConcurrentGroupSwitchesAllCount(t *testing.T) {
	h := newHarness(t)
	token := h.user("alice")
	gids := []string{h.group(token, "一"), h.group(token, "二"), h.group(token, "三")}
	dev := h.device("AA:BB:CC:DD:EE:09")
	h.must(200, h.call("POST", "/api/devices/claims", token, map[string]string{"pairCode": dev.PairCode}, nil), "claim")

	const n = 7
	statuses := make(chan int, n)
	for range n {
		go func() {
			statuses <- h.call("POST", "/api/device/group", dev.Secret, api.DeviceGroupRequest{Protocol: api.DeviceProtocol, Action: "next"}, nil)
		}()
	}
	for range n {
		h.must(200, <-statuses, "next group")
	}
	var d api.Device
	h.must(200, h.call("GET", "/api/devices/"+dev.DeviceID, token, nil, &d), "get device")
	if d.GroupID == nil || *d.GroupID != gids[n%len(gids)] {
		t.Fatalf("after %d switches group = %v, want %s", n, d.GroupID, gids[n%len(gids)])
	}
}

func TestPatchDeviceRequiresOwner(t *testing.T) {
	h := newHarness(t)
	alice, bob := h.user("alice"), h.user("bob")
	dev := h.device("AA:BB:CC:DD:EE:02")
	h.must(200, h.call("POST", "/api/devices/claims", alice, map[string]string{"pairCode": dev.PairCode}, nil), "claim")

	h.must(404, h.call("PATCH", "/api/devices/"+dev.DeviceID, bob, map[string]any{"name": "bob's"}, nil), "foreign patch")

	// Renames racing an unbind either land before it or see the device as gone; none
	// may rename a device that alice no longer owns.
	var wg sync.WaitGroup
	statuses := make(chan int, 8)
	for i := range 8 {
		wg.Go(func() {
			statuses <- h.call("PATCH", "/api/devices/"+dev.DeviceID, alice, map[string]any{"name": "rename-" + strconv.Itoa(i)}, nil)
		})
	}
	h.must(200, h.call("DELETE", "/api/devices/"+dev.DeviceID+"/binding", alice, nil, nil), "unbind")
	wg.Wait()
	close(statuses)
	for s := range statuses {
		if s != 200 && s != 404 {
			t.Fatalf("concurrent patch status %d", s)
		}
	}
	var name *string
	if err := h.st.Pool.QueryRow(context.Background(), "SELECT name FROM devices WHERE id = $1", dev.DeviceID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	h.must(404, h.call("PATCH", "/api/devices/"+dev.DeviceID, alice, map[string]any{"name": "after"}, nil), "patch after unbind")
	if name != nil && *name == "after" {
		t.Fatal("unbound device renamed")
	}
}

func TestDynamicPatchFailureKeepsContent(t *testing.T) {
	h := newHarness(t)
	token := h.user("alice")
	gid := h.group(token, "天气")
	ctx := context.Background()

	// Seed a weather frame directly: creating one through the API would need QWeather.
	hash := blob.Hash(make([]byte, api.FrameBytes))
	id := "c" + randomHex(8)
	cfg := `{"type":"weather","tz":"Asia/Shanghai","locationId":"101010100","locationLabel":"北京","refreshIntervalSec":1800}`
	data := `{"updatedAt":"` + time.Now().UTC().Format(time.RFC3339) + `"}`
	_, err := h.st.Pool.Exec(ctx, `INSERT INTO contents (id, group_id, sort_order, kind, frame_name, image_hash) VALUES ($1, $2, 0, 'dynamic', '北京天气', $3)`, id, gid, hash)
	if err == nil {
		_, err = h.st.Pool.Exec(ctx, `INSERT INTO content_dynamic (content_id, type, config, data, rendered_at) VALUES ($1, 'weather', $2, $3, now())`, id, cfg, data)
	}
	if err != nil {
		t.Fatal(err)
	}

	// Switching city must fetch fresh data; without a QWeather key that fails, and the
	// old city's config, frame name and data must stay as they were.
	patch := map[string]any{"config": map[string]any{"type": "weather", "tz": "Asia/Shanghai", "locationId": "101020100", "locationLabel": "上海", "refreshIntervalSec": 1800}}
	if s := h.call("PATCH", "/api/contents/"+id, token, patch, nil); s < 400 {
		t.Fatalf("patch status %d, want failure", s)
	}
	var gotCfg map[string]any
	var gotName string
	if err := h.st.Pool.QueryRow(ctx, `SELECT d.config, c.frame_name FROM content_dynamic d JOIN contents c ON c.id = d.content_id WHERE d.content_id = $1`, id).Scan(&gotCfg, &gotName); err != nil {
		t.Fatal(err)
	}
	if gotCfg["locationId"] != "101010100" || gotName != "北京天气" {
		t.Fatalf("failed patch was persisted: config=%v frameName=%q", gotCfg, gotName)
	}

	// Preview follows the same rule: the old city's data must not stand in for the new one.
	if s := h.call("POST", "/api/contents/"+id+"/preview", token, map[string]any{"config": patch["config"]}, nil); s < 400 {
		t.Fatalf("preview status %d, want failure", s)
	}
}

func TestReplacingImageKeepsAudio(t *testing.T) {
	h := newHarness(t)
	token := h.user("alice")
	gid := h.group(token, "相册")
	var c api.Content
	h.must(201, h.call("POST", "/api/groups/"+gid+"/contents", token, frameUpload(make([]byte, api.FrameBytes), "a"), &c), "upload")
	if _, err := h.st.Pool.Exec(context.Background(), `INSERT INTO content_audio (content_id, source, status, voice, text) VALUES ($1, 'tts', 'pending', '冰糖', '你好')`, c.ID); err != nil {
		t.Fatal(err)
	}
	next := make([]byte, api.FrameBytes)
	next[0] = 0x0f
	h.must(200, h.call("PATCH", "/api/contents/"+c.ID, token, frameUpload(next, "a"), &c), "replace image")
	if c.Audio == nil || c.Audio.Text == nil || *c.Audio.Text != "你好" {
		t.Fatalf("audio dropped on image replace: %+v", c.Audio)
	}
}

// Browsers send flac/opus/wma with an empty or generic type; the upload must still work.
func TestUploadAudioWithGenericType(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	h := newHarness(t)
	token := h.user("alice")
	gid := h.group(token, "相册")
	audio, err := os.ReadFile("../media/testdata/tone.flac")
	if err != nil {
		t.Fatal(err)
	}
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	part, _ := w.CreateFormFile("frame", "frame.bin")
	_, _ = part.Write(make([]byte, api.FrameBytes))
	part, _ = w.CreateFormFile("audio", "tone.flac") // application/octet-stream
	_, _ = part.Write(audio)
	_ = w.Close()
	var c api.Content
	h.must(201, h.call("POST", "/api/groups/"+gid+"/contents", token, multipartBody{buf, w.FormDataContentType()}, &c), "upload with audio")
	if c.Audio == nil || c.Audio.Hash == nil {
		t.Fatalf("audio not stored: %+v", c.Audio)
	}
}

func TestUploadRejectsExtraFields(t *testing.T) {
	h := newHarness(t)
	token := h.user("alice")
	gid := h.group(token, "相册")
	form := func(fields map[string][]byte, dup string) multipartBody {
		buf := &bytes.Buffer{}
		w := multipart.NewWriter(buf)
		for name, v := range fields {
			part, _ := w.CreateFormFile(name, name+".bin")
			_, _ = part.Write(v)
		}
		if dup != "" {
			_ = w.WriteField(dup, "again")
		}
		_ = w.Close()
		return multipartBody{buf, w.FormDataContentType()}
	}
	frame := make([]byte, api.FrameBytes)
	path := "/api/groups/" + gid + "/contents"
	h.must(400, h.call("POST", path, token, form(map[string][]byte{"frame": frame, "extra": []byte("x")}, ""), nil), "unknown field")
	h.must(400, h.call("POST", path, token, form(map[string][]byte{"frame": frame, "frameName": []byte("a")}, "frameName"), nil), "duplicate field")
	// The total limit holds even for bytes no field reads, such as a preamble.
	big := form(map[string][]byte{"frame": frame}, "")
	preamble := []byte("preamble\r\n")
	big.buf = bytes.NewBuffer(append(bytes.Repeat(preamble, maxUploadBytes/len(preamble)+1), append([]byte("\r\n"), big.buf.Bytes()...)...))
	h.must(413, h.call("POST", path, token, big, nil), "oversized body")
}

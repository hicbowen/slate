package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
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
func (h *harness) call(method, path, token string, body any, out any) int {
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
	big.buf = bytes.NewBuffer(append(bytes.Repeat([]byte("preamble\r\n"), 800<<10), append([]byte("\r\n"), big.buf.Bytes()...)...))
	h.must(413, h.call("POST", path, token, big, nil), "oversized body")
}

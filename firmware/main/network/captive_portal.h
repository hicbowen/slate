#pragma once

// SoftAP captive portal:开机 NVS 无凭据时,设备开 AP "Slate-XXXX",
// 手机连进来后浏览器打开 192.168.4.1，可查看/忘记已保存网络并添加一组新网络。
// POST /submit 接 JSON {ssid, password, server_url}
// → APSTA 试连 → 成功后写 NVS namespace "slate.net" → 重启并自动选网。
// 设备名(name)不在配网阶段填,绑定后由 Web 端 PUT /devices/:id 设置。
//
// 用法:
//   CaptivePortal portal;
//   portal.Start();             // 同步 起 AP + HTTP server
//   while (!portal.Submitted()) vTaskDelay(...);  // 或注册 OnSubmit 回调
//   portal.Stop();

#include <esp_http_server.h>

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "network/dns_hijack.h"

class CaptivePortal {
   public:
    struct Submission {
        std::string ssid;
        std::string password;
        std::string server_url;
    };

    struct SavedNetwork {
        std::string ssid;
        bool        preferred = false;
    };

    bool Start();  // 启 SoftAP + HTTP + DNS,立即返回
    void Stop();

    // 用户提交配网信息时的回调。回调内做"试连验证"(wifi.TryConnect),
    // 不能直接 portal.Stop()或重启,只验证 + 写 NVS。
    // - return true:提交合法 ssid/pwd,/submit 回 {success:true},
    //   随后 portal 内部启 task 延 2s 调 OnFinished(true)
    // - return false:验证失败,out_error 填可读中文,/submit 回
    //   {success:false,error:msg},表单保留给用户改密码重提
    using SubmitCb        = std::function<bool(const Submission&, std::string& out_error)>;
    using FinishedCb      = std::function<void(bool success)>;
    using ListNetworksCb  = std::function<std::vector<SavedNetwork>()>;
    using ForgetNetworkCb = std::function<bool(const std::string& ssid)>;

    void OnSubmit(SubmitCb cb);
    void OnFinished(FinishedCb cb);
    void OnListNetworks(ListNetworksCb cb);
    void OnForgetNetwork(ForgetNetworkCb cb);
    void SetServerUrl(std::string server_url);

    bool Running() const {
        return running_.load();
    }

    ~CaptivePortal();

   private:
    std::atomic<bool>                  running_{false};
    httpd_handle_t                     server_ = nullptr;
    SubmitCb                           on_submit_;
    FinishedCb                         on_finished_;
    ListNetworksCb                     on_list_networks_;
    ForgetNetworkCb                    on_forget_network_;
    std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
    DnsHijack                          dns_;
    std::string                        ap_url_ = "http://192.168.4.1/";
    std::string                        server_url_;

    static esp_err_t HandleRoot(httpd_req_t* req);
    static esp_err_t HandleScan(httpd_req_t* req);
    static esp_err_t HandleProfiles(httpd_req_t* req);
    static esp_err_t HandleForget(httpd_req_t* req);
    static esp_err_t HandleSubmit(httpd_req_t* req);
    static esp_err_t HandleDone(httpd_req_t* req);
    static esp_err_t HandleExit(httpd_req_t* req);
    // captive portal "万能" handler:任何未知 URL 都重定向到 /
    static esp_err_t HandleCatchAll(httpd_req_t* req);
    static void      FinishTask(void* arg);
    static void      StopTask(void* arg);
};

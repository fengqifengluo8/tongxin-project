package com.example.tongxinproject.controller;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;

/**
 * CA证书下载接口 — 客户端安装后消除HTTPS安全警告
 */
@RestController
public class CertController {

    @GetMapping("/ca-cert")
    public ResponseEntity<byte[]> downloadCACert() throws IOException {
        ClassPathResource resource = new ClassPathResource("tongxin-ca.crt");
        byte[] certBytes = resource.getInputStream().readAllBytes();

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=tongxin-ca.crt")
                .header(HttpHeaders.CONTENT_TYPE, "application/x-x509-ca-cert")
                .contentLength(certBytes.length)
                .body(certBytes);
    }

    @GetMapping("/cert-help")
    public ResponseEntity<String> certHelpPage() {
        String html = """
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>证书安装指南</title>
            <style>
            body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#333}
            h1{color:#1e3a5f}h2{color:#2563eb;margin-top:2rem;border-bottom:2px solid #dbeafe;padding-bottom:.3rem}
            .step{background:#f0f7ff;border-left:4px solid #2563eb;padding:.8rem 1rem;margin:.5rem 0;border-radius:0 8px 8px 0}
            .download{display:inline-block;background:#2563eb;color:#fff;padding:.8rem 2rem;border-radius:8px;text-decoration:none;font-size:1.1rem;margin:1rem 0}
            code{background:#f1f5f9;padding:.15rem .4rem;border-radius:4px;font-size:.9em}
            .note{background:#fef3c7;border:1px solid #f59e0b;padding:1rem;border-radius:8px;margin:1rem 0}
            img{max-width:100%}
            </style>
            </head>
            <body>
            <h1>🔒 安全证书安装指南</h1>
            <p>安装此CA证书后，浏览器将信任本系统，不再显示安全警告，定位功能也可正常使用。</p>

            <a class="download" href="/ca-cert">📥 下载CA证书 (tongxin-ca.crt)</a>

            <div class="note">⚠️ 证书仅用于本地开发和局域网测试，有效期10年。此CA密钥仅存在于本机。</div>

            <h2>Windows / 桌面浏览器</h2>
            <div class="step">1. 双击下载的 <code>tongxin-ca.crt</code> 文件</div>
            <div class="step">2. 点击 <b>"安装证书"</b> → 存储位置选<b>"当前用户"</b></div>
            <div class="step">3. 选择 <b>"将所有的证书放入下列存储"</b> → 浏览</div>
            <div class="step">4. 选择 <b>"受信任的根证书颁发机构"</b> → 确定 → 完成</div>
            <div class="step">5. 重启浏览器，地址栏应显示 🔒 绿色锁</div>

            <h2>Android 手机</h2>
            <div class="step">1. 在手机浏览器打开 <code>https://10.15.217.222:6061/cert-help</code></div>
            <div class="step">2. 点击上方下载按钮，保存证书文件</div>
            <div class="step">3. 设置 → 安全 → 加密与凭据 → <b>安装证书</b> → CA证书</div>
            <div class="step">4. 选择下载的 <code>tongxin-ca.crt</code> → 确认安装</div>

            <h2>iPhone / iPad</h2>
            <div class="step">1. Safari打开 <code>https://10.15.217.222:6061/cert-help</code></div>
            <div class="step">2. 点击下载按钮 → 允许下载配置描述文件</div>
            <div class="step">3. 设置 → 通用 → <b>VPN与设备管理</b> → 安装描述文件</div>
            <div class="step">4. 设置 → 通用 → 关于本机 → <b>证书信任设置</b> → 开启信任</div>

            <h2>安装后验证</h2>
            <p>重新打开 <code>https://10.15.217.222:6061</code>，地址栏应显示 🔒 锁图标，点击可看到"连接是安全的"。</p>
            </body>
            </html>
            """;
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(html);
    }
}

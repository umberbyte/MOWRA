# MOWRA アプリアイコン一式ガイド

Electron アプリ「MOWRA」用のクロスプラットフォーム対応アイコンセットです。
四隅は透過（Alpha=0）処理済みで、macOSのDockおよびWindowsのタスクバー・エクスプローラーに自然に馴染みます。

---

## 📁 フォルダ構成

```
mowra-app-icons/
├── mac/
│   ├── icon.icns             # macOS アプリ用（16x16 〜 1024x1024 マルチ解像度）
│   └── mowra.iconset/        # macOS iconset 原盤フォルダ
├── win/
│   └── icon.ico              # Windows アプリ用（16, 24, 32, 48, 64, 128, 256 マルチ解像度）
├── png/
│   ├── icon.png              # 1024x1024 マスター透過PNG（Linux / Web / PWA等）
│   ├── icon_1024x1024.png
│   ├── icon_512x512.png
│   ├── icon_256x256.png
│   ├── icon_128x128.png
│   ├── icon_64x64.png
│   ├── icon_48x48.png
│   ├── icon_32x32.png
│   ├── icon_16x16.png
│   ├── tray-icon.png         # システムトレイ用（32x32）
│   └── tray-icon-small.png   # システムトレイ用（16x16）
└── original/
    └── mowra_bot_original.jpg # 生成元画像
```

---

## 🛠 Electron での設定例

### 1. `electron-builder` を使用する場合（推奨）

`package.json` または `electron-builder.yml` の設定例：

```json
{
  "build": {
    "appId": "com.mowra.app",
    "productName": "MOWRA",
    "directories": {
      "buildResources": "build"
    },
    "mac": {
      "icon": "build/icon.icns",
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "icon": "build/icon.ico"
    },
    "linux": {
      "icon": "build/icon.png",
      "category": "Development"
    }
  }
}
```
> ※ プロジェクトルートの `build/` フォルダ配下に `icon.icns`, `icon.ico`, `icon.png` を配置すると、自動的に各プラットフォーム向けに適用されます。

---

### 2. アプリ実行時のウィンドウアイコン（`main.js` / `main.ts`）

Windows / Linux では、アプリ起動時のウィンドウ左上やタスクバーにアイコンを反映させるために `BrowserWindow` でアイコンを指定します。

```javascript
const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // ウィンドウアイコンの設定（Windows / Linux 用）
    icon: path.join(__dirname, 'assets/icons/png/icon_256x256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
}

// システムトレイアイコンの設定（必要な場合）
let tray = null;
app.whenReady().then(() => {
  createWindow();

  const trayIconPath = path.join(__dirname, 'assets/icons/png/tray-icon.png');
  tray = new Tray(trayIconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'MOWRA を表示', click: () => { /* ウィンドウ復元 */ } },
    { type: 'separator' },
    { label: '終了', role: 'quit' }
  ]);
  tray.setToolTip('MOWRA - システムテスト補佐ツール');
  tray.setContextMenu(contextMenu);
});
```

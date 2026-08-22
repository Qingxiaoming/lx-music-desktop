/**
 * This file is used specifically and only for development. It installs
 * `electron-debug` & `vue-devtools`. There shouldn't be any need to
 *  modify this file, but it can be used to extend your development
 *  environment.
 */

import { app } from 'electron'
import electronDebug from 'electron-debug'
import { openDevTools } from './utils'
// Install `electron-debug` with `devtron`
electronDebug({
  showDevTools: false,
  devToolsMode: 'undocked',
})

// 不再自动安装 Vue DevTools：
// 本机无法访问 Google CRX 下载地址，安装必然失败，每次启动都会产生
// “Invalid header: Does not start with Cr24” 及 session.getAllExtensions 弃用警告等噪音。
// 如需使用，可手动下载扩展后通过 session.extensions.loadExtension 加载。
app.on('ready', () => {
  global.lx.event_app.on('main_window_created', (win) => {
    openDevTools(win.webContents)
  })
  global.lx.event_app.on('desktop_lyric_window_created', (win) => {
    openDevTools(win.webContents)
  })
})

// Require `main` process to boot app
require('./index')

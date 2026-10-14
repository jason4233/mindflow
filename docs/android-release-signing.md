# Android APK 正式簽章與版本號設定（給專案擁有者）

這份文件說明如何讓 GitHub Actions 產出的 MindFlow Android APK 一直用**同一把正式簽章金鑰**簽名，
讓手機上的 App 可以直接「覆蓋安裝」更新，而不必先解除安裝（解除安裝會刪掉手機上的心智圖資料）。

整個設定只需要做一次，大約 15 分鐘。

> **重要：在你把下面第 3 步的 4 個 GitHub Secrets 加好之前，CI 會繼續產生「拋棄式簽章」的 APK。**
> 每一次建置都用一把臨時產生、用完即丟的金鑰簽名，所以每個 APK 都**無法**覆蓋安裝前一個 APK。
> 這種建置在 GitHub Actions 的執行頁面會出現黃色警告「Throwaway signing key」。

---

## 為什麼需要這樣做

- Android 規定：只有「用同一把金鑰簽名」的新版 APK，才能覆蓋安裝舊版。金鑰不同時，手機會顯示
  「應用程式未安裝」或「套件與現有套件衝突」。
- 目前 CI 每次都產生新的臨時金鑰，所以使用者每次更新都得先解除安裝，**本機資料會一起被刪除**。
- 建立一把正式金鑰（release keystore）並交給 GitHub Actions 保管後，之後每一個 APK 都用同一把金鑰簽名，
  就能正常覆蓋更新，資料保留。

---

## 第 1 步：在自己的電腦建立正式金鑰（只做一次）

需要 `keytool` 指令（Java 內建）。

- **Windows**：如果有裝 Android Studio，`keytool` 在
  `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`；
  沒有的話可以安裝免費的 [Eclipse Temurin JDK 21](https://adoptium.net/)，安裝後在 PowerShell 直接打 `keytool`。
- **macOS / Linux**：安裝任一 JDK 後直接使用 `keytool`。

在一個**不在 MindFlow 專案資料夾裡**的位置（例如「文件」資料夾）開啟終端機 / PowerShell，執行下面這一行
（整行複製貼上即可）：

```
keytool -genkeypair -v -keystore mindflow-release.jks -storetype PKCS12 -alias mindflow -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=MindFlow, O=MindFlow, C=TW"
```

Windows 若找不到 `keytool`，把開頭的 `keytool` 換成
`& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"`。

- 它會要求輸入兩次**金鑰庫密碼**（至少 6 個字元）。請用密碼管理器產生一組長的隨機密碼並記下來。
- 這是 PKCS12 格式，**金鑰密碼和金鑰庫密碼是同一組**，不會另外再問。
- `-alias mindflow` 是金鑰的名字（別名），等一下會用到。
- `-validity 36500` 代表有效期約 100 年，不需要再續期。

完成後資料夾裡會多一個 `mindflow-release.jks` 檔案，這就是正式金鑰。

（選用）記下金鑰指紋，之後可以用來確認 CI 用的是同一把金鑰：

```
keytool -list -v -keystore mindflow-release.jks -alias mindflow
```

輸出中的「SHA256:」那一行就是指紋。GitHub Actions 每次建置的摘要（Summary）會顯示
「Certificate SHA-256」，內容應與它相同（CI 顯示小寫、沒有冒號，比對時忽略大小寫與冒號即可）。

---

## 第 2 步：把金鑰檔轉成 base64 文字

GitHub Secrets 只能存文字，所以要把 `.jks` 檔轉成一串 base64 文字。

- **Windows PowerShell**（在 `mindflow-release.jks` 所在的資料夾執行，結果會直接複製到剪貼簿）：

  ```
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\mindflow-release.jks")) | Set-Clipboard
  ```

- **macOS**：

  ```
  base64 -i mindflow-release.jks | pbcopy
  ```

- **Linux**（把輸出整串複製起來）：

  ```
  base64 -w0 mindflow-release.jks
  ```

這串文字跟金鑰檔本身一樣機密：貼到 GitHub 之後不要另存檔案，也不要貼到聊天軟體或 Issue。

---

## 第 3 步：在 GitHub 新增 4 個 Secrets

1. 打開 GitHub 上的 MindFlow repository 頁面。
2. 點 **Settings（設定）** → 左側 **Secrets and variables** → **Actions**。
3. 在 **Repository secrets** 區塊按 **New repository secret**，依序新增以下 4 個（名稱必須完全一樣，大寫）：

| Secret 名稱 | 要填的內容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 第 2 步複製的那一整串 base64 文字 |
| `ANDROID_KEYSTORE_PASSWORD` | 第 1 步設定的金鑰庫密碼 |
| `ANDROID_KEY_ALIAS` | `mindflow`（第 1 步 `-alias` 後面的名字） |
| `ANDROID_KEY_PASSWORD` | 金鑰密碼；PKCS12 格式時與金鑰庫密碼**相同** |

4. 到 **Actions** 分頁 → 左側選 **Build and publish Android release** → **Run workflow**（分支選 `main`），
   手動跑一次。
5. 執行完成後點進去看 **Summary**：
   - 「Signing」應該顯示 `release`，而且**不再**出現「Throwaway signing key」黃色警告。
   - 如果出現紅色錯誤「Release keystore check failed」，代表密碼或別名填錯；
     「Invalid ANDROID_KEYSTORE_BASE64」代表 base64 文字不完整，重做第 2 步再貼一次。
     這兩種情況 CI 會直接失敗，不會偷偷改用拋棄式金鑰，以免發出無法覆蓋安裝的 APK。

GitHub Secrets 加好之後只能覆寫、不能再讀出來，所以它**不能**當成金鑰的備份（見第 4 步）。

關於 Pull Request：

- 從**本 repository 的分支**開的 PR，建置會用正式金鑰簽名，下載下來可以直接覆蓋安裝測試。
  這也代表任何有本 repository 推送權限的人都能產出正式簽名的 APK，請只把推送權限給信任的人。
- 從 **fork** 開的 PR 拿不到 Secrets（GitHub 的安全規則），會是拋棄式簽章，只能在解除安裝後安裝。

---

## 第 4 步：備份金鑰（非常重要）

- **金鑰檔或密碼一旦遺失，就再也無法發佈能覆蓋安裝的更新。** 所有使用者都必須解除安裝（資料會被刪）
  才能裝新的 APK。沒有任何人（包括 Google、GitHub）能幫你找回。
- **金鑰外洩**的話，別人可以做出能覆蓋安裝你 App 的惡意「更新」。

建議做法：

1. 把 `mindflow-release.jks` 存到至少**兩個**不同的地方，例如：密碼管理器（1Password、Bitwarden 等可附加檔案）
   ＋ 一支只用來備份、放在家裡的加密隨身碟。
2. 密碼存在密碼管理器裡，**不要**和金鑰檔放在同一個未加密的地方。
3. **絕對不要**把金鑰檔放進 MindFlow 專案資料夾或 commit 到 git。
   （專案的 `.gitignore` 已經忽略 `*.jks`、`*.keystore`，但請不要依賴它。）
4. 備份完成後，可以刪掉電腦上其他多餘的副本與 base64 文字。

---

## 第 5 步：從舊版 APK 切換時，需要「一次性」解除安裝

手機上現在裝的 MindFlow 是用拋棄式金鑰簽的，第一個正式簽名的 APK **無法**覆蓋它。只有這一次需要解除安裝，
之後的更新都能直接覆蓋。

切換前請先保住資料（任選其一或都做）：

1. **用 App 內的 GitHub 同步**把所有心智圖上傳到你的私有 repository，確認同步成功。
2. 或在 App 裡把每一張心智圖用「匯出」存成檔案，放到手機以外的地方。

然後：

1. 解除安裝舊的 MindFlow。
2. 安裝新的、正式簽名的 APK（從 Releases 的 `latest` 下載 `MindFlow.apk`）。
3. 重新設定 GitHub 同步並下載資料，或把匯出的檔案匯入回來。

注意：

- 不要依賴 Android 的自動備份還原，簽章不同時系統不保證會還原。
- GitHub 同步用的權杖（token）存在手機的加密儲存區（Android Keystore），**刻意不會被備份或搬移**到新手機，
  換手機或重新安裝後需要重新輸入一次。

---

## 版本號規則

每次 CI 建置都會自動產生版本號，不需要手動改任何檔案：

| 項目 | 規則 | 例子（第 57 次執行） |
|---|---|---|
| `versionCode`（Android 用來判斷新舊的整數） | `10000 + 執行編號` | `10057` |
| `versionName`（顯示給人看的版本） | `1.1.<執行編號>` | `1.1.57` |
| PR 建置的 `versionName` | `1.1.<執行編號>-pr<PR 編號>` | `1.1.57-pr12` |

- 「執行編號」是 GitHub Actions 中 **Build and publish Android release** 這個 workflow 的 run number，
  每跑一次（不論 main、tag 或 PR）就加 1，所以 versionCode 一定越來越大，也一定大於舊 APK 的 `1`。
- Android 不允許用 versionCode 比較小的 APK 覆蓋較大的版本。若哪天 workflow 檔被改名或重建，
  執行編號會從 1 重新開始，這時要把 `.github/workflows/android.yml` 裡的 `10000` 改成更大的數字
  （例如 `20000`），確保新版號仍比已發佈的大。
- 版本號可以在手機「設定 → 應用程式 → MindFlow」看到；App 內也可透過 `App.getInfo()` 讀到
  （`build` = versionCode，`version` = versionName）。
- 在自己電腦本機建置、沒有設定環境變數時，版本固定是 `versionCode 1` / `versionName 1.0-dev`，只供開發測試。

## APK 會放在哪裡

| 觸發方式 | 產出位置 |
|---|---|
| 推送到 `main` | Releases 的 `latest`：`MindFlow.apk`（固定下載連結）與 `MindFlow-<versionCode>.apk`（只保留目前這一個，App 的更新檢查會找這個檔名） |
| 推送 `v*` 標籤（例如 `v1.2.0`） | 該標籤的 Release：`MindFlow-<versionCode>.apk`（Release 不存在時會自動建立） |
| Pull Request | **不會**發佈到 Releases；在該次 Actions 執行頁面最下方的 **Artifacts** 下載 `MindFlow-pr<PR 編號>-<versionCode>`（zip 內含 APK），保留 14 天 |

---

## （選用）在自己電腦建置正式簽名的 APK

一般不需要，CI 會處理。若真的要在本機建置，先設定以下環境變數再執行
`cd mobile && npm run sync && cd android && ./gradlew assembleRelease`：

| 環境變數 | 內容 |
|---|---|
| `MINDFLOW_KEYSTORE_PATH` | `mindflow-release.jks` 的完整路徑 |
| `MINDFLOW_KEYSTORE_PASSWORD` | 金鑰庫密碼 |
| `MINDFLOW_KEY_ALIAS` | `mindflow` |
| `MINDFLOW_KEY_PASSWORD` | 金鑰密碼 |
| `MINDFLOW_VERSION_CODE`（選用） | 例如 `10100`，必須大於手機上已安裝的版本 |
| `MINDFLOW_VERSION_NAME`（選用） | 例如 `1.1.100` |

4 個簽章變數必須**全部**設定才會簽名；少任何一個，產出的 `app-release-unsigned.apk` 就是未簽名的。
建置過程不會印出任何密碼。

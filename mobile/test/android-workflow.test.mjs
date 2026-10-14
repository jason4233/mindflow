import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../../.github/workflows/android.yml', import.meta.url)

// Windows 上 core.autocrlf=true 的 checkout 是 CRLF：先統一成 LF，下面的比對才與平台無關。
async function readWorkflow() {
  return (await readFile(workflowUrl, 'utf8')).replace(/\r\n/g, '\n')
}

function jobBlock(workflow, name) {
  // Top-level jobs are indented by two spaces; a job ends where the next one starts.
  const start = workflow.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} must exist`)
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/)
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next)
}

test('Android workflow builds PRs and tags with the Capacitor 8 toolchain', async () => {
  const workflow = await readWorkflow()

  assert.match(workflow, /\n {2}push:\n {4}branches:\n {6}- main\n/)
  assert.match(workflow, /\n {4}tags:\n {6}- "v\*"\n/)
  assert.match(workflow, /\n {2}pull_request:\n {4}paths:\n/)
  assert.match(workflow, /\n {2}workflow_dispatch:\n/)
  assert.match(workflow, /java-version: "21"/)
  assert.match(workflow, /"platforms;android-36"/)
  assert.match(workflow, /code=\$\(\(10000 \+ RUN_NUMBER\)\)/)
  assert.match(workflow, /name="1\.1\.\$\{RUN_NUMBER\}"/)
})

test('Android workflow pins the exact permission set of the built APK', async () => {
  const workflow = await readWorkflow()
  const block = workflow.match(/expected_permissions="\$\(printf '%s\\n' \\\n([\s\S]*?)\)"/)?.[1]
  assert.ok(block, 'expected_permissions whitelist must exist')
  const permissions = block.split(/\\?\n/).map(line => line.trim()).filter(Boolean)
  assert.deepEqual(permissions, [
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.INTERNET',
    'com.mindflow.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
  ])
  assert.ok(!permissions.includes('android.permission.CAMERA'))
  assert.match(workflow, /"\$actual_permissions" != "\$expected_permissions"/)
})

test('Android workflow keeps secrets out of logs and PRs away from releases', async () => {
  const workflow = await readWorkflow()

  // Secrets may only be mapped into env vars, never interpolated into a run script.
  for (const line of workflow.split('\n').filter(text => text.includes('secrets.'))) {
    assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ secrets\.ANDROID_[A-Z0-9_]+ \}\}$/, line)
  }
  assert.doesNotMatch(workflow, /set -x/)
  assert.match(workflow, /::warning title=Throwaway signing key::/)

  assert.match(workflow, /\npermissions:\n {2}contents: read\n/)
  const build = jobBlock(workflow, 'build')
  const publish = jobBlock(workflow, 'publish')
  assert.match(build, /permissions:\n {6}contents: read/)
  assert.doesNotMatch(build, /contents: write|gh release/)
  assert.match(build, /actions\/upload-artifact@v4/)
  assert.match(build, /retention-days: 14/)
  assert.match(build, /MindFlow-pr\$\{PR_NUMBER\}-\$\{VERSION_CODE\}/)

  assert.match(publish, /permissions:\n {6}contents: write/)
  assert.match(publish, /if: \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) && /)
  assert.doesNotMatch(publish, /pull_request/)
  assert.match(publish, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(publish, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(publish, /"\$main_sha" != "\$GITHUB_SHA"/, 'latest must keep the stale-run guard')
  assert.match(publish, /gh release upload latest "\$stable" "\$versioned" --clobber/)
  assert.match(publish, /gh release delete-asset latest/)
  // 拋棄式簽章的 APK 無法覆蓋安裝：只發 MindFlow.apk，不放帶版號的檔案，App 內就不會提示更新。
  assert.match(publish, /if \[\[ "\$SIGNING_MODE" == "release" \]\]; then\s+gh release upload latest "\$stable" "\$versioned"/)
  assert.match(publish, /else[\s\S]*?gh release upload latest "\$stable" --clobber/)
  assert.match(workflow, /signing_mode: \$\{\{ steps\.signing\.outputs\.mode \}\}/)
})

test('M1 複審：拋棄式簽章的建置不會蓋掉 latest 上正式簽章的 APK', async () => {
  const workflow = await readWorkflow()
  const publish = jobBlock(workflow, 'publish')
  const latestStep = publish.slice(publish.indexOf('- name: Upload APK to the rolling latest release'))
  const branchStart = latestStep.indexOf('if [[ "$SIGNING_MODE" == "release" ]]; then')
  const elseAt = latestStep.indexOf('\n          else\n', branchStart)
  const fiAt = latestStep.indexOf('\n          fi', elseAt)
  assert.ok(branchStart >= 0 && elseAt > branchStart && fiAt > elseAt, '要有正式簽章／拋棄式簽章兩個分支')
  const releaseBranch = latestStep.slice(branchStart, elseAt)
  const throwawayBranch = latestStep.slice(elseAt, fiAt)

  // 清理舊版號 APK 只在正式簽章時做：拋棄式簽章的建置不能刪掉最後一個裝得上去的正式 APK
  assert.match(releaseBranch, /gh release delete-asset latest "\$asset"/)
  assert.match(releaseBranch, /"\$asset" != "\$versioned_name"/)
  assert.doesNotMatch(throwawayBranch, /delete-asset/)
  assert.doesNotMatch(latestStep.slice(fiAt), /delete-asset/, '分支之後不能再有共用的清理迴圈')

  // latest 已有正式簽章的帶版號 APK → 整個跳過發佈並發 warning，連 MindFlow.apk 都不蓋
  const skipCheck = throwawayBranch.indexOf("grep -Eq '^MindFlow-[0-9]+\\.apk$' <<< \"$latest_assets\"")
  const skipExit = throwawayBranch.indexOf('exit 0', skipCheck)
  const upload = throwawayBranch.indexOf('gh release upload latest "$stable" --clobber')
  assert.ok(skipCheck >= 0, '要先檢查 latest 上有沒有正式簽章的 APK')
  assert.ok(skipExit > skipCheck && skipExit < upload, '有的話要在上傳之前結束')
  assert.match(throwawayBranch, /::warning title=Latest release left unchanged::/)
  // 不能把 gh 的輸出直接 pipe 給 grep -q：pipefail 下 SIGPIPE 會讓判斷走錯分支
  assert.match(throwawayBranch, /latest_assets="\$\(gh release view latest --repo "\$repo" --json assets --jq "\.assets\[\]\.name"\)"/)
  assert.doesNotMatch(throwawayBranch, /\| *grep -E?q/)
})

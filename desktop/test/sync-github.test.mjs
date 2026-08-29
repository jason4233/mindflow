import assert from 'node:assert/strict'
import test from 'node:test'

const adapterUrl = new URL('../sync-github.mjs', import.meta.url)
const cfg = {
  apiBase: 'https://github.example/api/v3/',
  token: 'github_pat_secret',
  repo: 'chenrui/mindflow-sync',
  branch: 'feature/sync'
}

async function loadAdapter() {
  try {
    return await import(adapterUrl)
  } catch {
    return null
  }
}

async function withFetch(fakeFetch, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeFetch
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

test('getRef requests the configured branch and returns its SHA and ETag', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ object: { sha: 'commit-sha' } }), {
      status: 200,
      headers: { etag: '"ref-v1"' }
    })
  }, async () => {
    const adapter = await loadAdapter()
    assert.equal(typeof adapter?.getRef, 'function')

    const result = await adapter.getRef(cfg, { etag: '"ref-v0"' })

    assert.deepEqual(result, {
      sha: 'commit-sha',
      etag: '"ref-v1"',
      notModified: false
    })
    assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/ref/heads/feature/sync')
    assert.equal(request.init.method, 'GET')
    assert.equal(request.init.headers.authorization, 'Bearer github_pat_secret')
    assert.equal(request.init.headers['if-none-match'], '"ref-v0"')
  })
})

test('getRef treats 304 as unchanged and forwards the numeric rate remainder', async () => {
  await withFetch(async () => new Response(null, {
    status: 304,
    headers: {
      etag: '"ref-v0"',
      'x-ratelimit-remaining': '4999'
    }
  }), async () => {
    const { getRef } = await loadAdapter()

    assert.deepEqual(await getRef(cfg, { etag: '"ref-v0"' }), {
      sha: null,
      etag: '"ref-v0"',
      notModified: true,
      rateRemaining: 4999
    })
  })
})

test('getRef uses the frozen API and branch defaults', async () => {
  let requestedUrl

  await withFetch(async url => {
    requestedUrl = url
    return jsonResponse({ object: { sha: 'default-sha' } })
  }, async () => {
    const { getRef } = await loadAdapter()
    await getRef({ token: 'token', repo: 'owner/repo' })
  })

  assert.equal(requestedUrl, 'https://api.github.com/repos/owner/repo/git/ref/heads/main')
})

test('getCommit maps the GitHub commit tree SHA', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({ sha: 'commit-sha', tree: { sha: 'tree-sha' } }, {
      headers: { 'x-ratelimit-remaining': '321' }
    })
  }, async () => {
    const { getCommit } = await loadAdapter()

    assert.deepEqual(await getCommit(cfg, 'commit sha'), {
      treeSha: 'tree-sha',
      rateRemaining: 321
    })
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/commits/commit%20sha')
  assert.equal(request.init.method, 'GET')
})

test('getTreeRecursive returns only blob entries indexed by path', async () => {
  let requestedUrl

  await withFetch(async url => {
    requestedUrl = url
    return jsonResponse({
      truncated: false,
      tree: [
        { path: 'manifest.json', mode: '100644', type: 'blob', sha: 'manifest-sha', size: 87 },
        { path: 'docs', mode: '040000', type: 'tree', sha: 'folder-sha' },
        { path: 'docs/a.json', mode: '100644', type: 'blob', sha: 'doc-sha', size: 2048 }
      ]
    })
  }, async () => {
    const { getTreeRecursive } = await loadAdapter()

    assert.deepEqual(await getTreeRecursive(cfg, 'tree-sha'), {
      byPath: {
        'manifest.json': { sha: 'manifest-sha', size: 87 },
        'docs/a.json': { sha: 'doc-sha', size: 2048 }
      }
    })
  })

  assert.equal(requestedUrl, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/trees/tree-sha?recursive=1')
})

test('getTreeRecursive rejects a truncated tree instead of exposing partial remote state', async () => {
  await withFetch(async () => jsonResponse({ truncated: true, tree: [] }), async () => {
    const { getTreeRecursive, SyncHttpError } = await loadAdapter()

    await assert.rejects(getTreeRecursive(cfg, 'tree-sha'), error => {
      assert.ok(error instanceof SyncHttpError)
      assert.equal(error.status, 200)
      assert.equal(error.retryable, false)
      assert.match(error.message, /truncated/i)
      return true
    })
  })
})

test('getBlobRaw decodes a UTF-8 blob larger than one MiB through git/blobs', async () => {
  const source = '外泌體同步資料\n'.repeat(100000)
  assert.ok(Buffer.byteLength(source, 'utf8') > 1024 * 1024)
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({
      sha: 'large-blob',
      encoding: 'base64',
      content: Buffer.from(source, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n')
    })
  }, async () => {
    const { getBlobRaw } = await loadAdapter()
    assert.equal(await getBlobRaw(cfg, 'large-blob'), source)
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/blobs/large-blob')
  assert.equal(request.init.method, 'GET')
})

test('createBlob sends UTF-8 content to the Git database endpoint', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({ sha: 'new-blob-sha' }, { status: 201 })
  }, async () => {
    const { createBlob } = await loadAdapter()
    assert.equal(await createBlob(cfg, '{"title":"晨睿"}'), 'new-blob-sha')
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/blobs')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(request.init.body), {
    content: '{"title":"晨睿"}',
    encoding: 'utf-8'
  })
})

test('createTree preserves blob replacements and null deletions', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({ sha: 'new-tree-sha' }, { status: 201 })
  }, async () => {
    const { createTree } = await loadAdapter()
    const result = await createTree(cfg, {
      baseTreeSha: 'base-tree',
      entries: [
        { path: 'manifest.json', sha: 'manifest-sha' },
        { path: 'docs/purged.json', sha: null }
      ]
    })

    assert.equal(result, 'new-tree-sha')
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/trees')
  assert.equal(request.init.method, 'POST')
  assert.deepEqual(JSON.parse(request.init.body), {
    base_tree: 'base-tree',
    tree: [
      { path: 'manifest.json', mode: '100644', type: 'blob', sha: 'manifest-sha' },
      { path: 'docs/purged.json', mode: '100644', type: 'blob', sha: null }
    ]
  })
})

test('createCommit uses exactly one parent and the supplied tree', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({ sha: 'new-commit-sha' }, { status: 201 })
  }, async () => {
    const { createCommit } = await loadAdapter()
    const result = await createCommit(cfg, {
      message: 'Sync from laptop',
      treeSha: 'tree-sha',
      parentSha: 'parent-sha'
    })

    assert.equal(result, 'new-commit-sha')
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/commits')
  assert.equal(request.init.method, 'POST')
  assert.deepEqual(JSON.parse(request.init.body), {
    message: 'Sync from laptop',
    tree: 'tree-sha',
    parents: ['parent-sha']
  })
})

test('updateRef performs a non-force branch update', async () => {
  let request

  await withFetch(async (url, init) => {
    request = { url, init }
    return jsonResponse({ object: { sha: 'new-commit-sha' } })
  }, async () => {
    const { updateRef } = await loadAdapter()
    assert.equal(await updateRef(cfg, 'new-commit-sha'), undefined)
  })

  assert.equal(request.url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync/git/refs/heads/feature/sync')
  assert.equal(request.init.method, 'PATCH')
  assert.deepEqual(JSON.parse(request.init.body), { sha: 'new-commit-sha', force: false })
})

test('updateRef classifies GitHub 422 as a retryable compare-and-swap conflict', async () => {
  await withFetch(async () => jsonResponse({ message: 'Update is not a fast forward' }, { status: 422 }), async () => {
    const { updateRef, SyncHttpError } = await loadAdapter()

    await assert.rejects(updateRef(cfg, 'new-commit-sha'), error => {
      assert.ok(error instanceof SyncHttpError)
      assert.equal(error.status, 422)
      assert.equal(error.retryable, true)
      assert.match(error.message, /not a fast forward/i)
      return true
    })
  })
})

test('validateRepo reports private writable repository capabilities', async () => {
  await withFetch(async () => jsonResponse({
    private: true,
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true }
  }, {
    headers: { 'x-ratelimit-remaining': '77' }
  }), async () => {
    const { validateRepo } = await loadAdapter()

    assert.deepEqual(await validateRepo(cfg), {
      exists: true,
      private: true,
      canWrite: true,
      rateRemaining: 77
    })
  })
})

test('validateRepo converts only repository 404 into exists false', async () => {
  await withFetch(async () => jsonResponse({ message: 'Not Found' }, { status: 404 }), async () => {
    const { validateRepo } = await loadAdapter()

    assert.deepEqual(await validateRepo(cfg), {
      exists: false,
      private: false,
      canWrite: false
    })
  })
})

test('ensureRepo creates a missing private repository under the authenticated user', async () => {
  const requests = []

  await withFetch(async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) {
      return jsonResponse({ message: 'Not Found' }, { status: 404 })
    }
    return jsonResponse({
      full_name: 'chenrui/mindflow-sync',
      private: true,
      permissions: { push: true }
    }, {
      status: 201,
      headers: { 'x-ratelimit-remaining': '42' }
    })
  }, async () => {
    const { ensureRepo } = await loadAdapter()

    assert.deepEqual(await ensureRepo(cfg), {
      exists: true,
      private: true,
      canWrite: true,
      rateRemaining: 42
    })
  })

  assert.equal(requests[0].url, 'https://github.example/api/v3/repos/chenrui/mindflow-sync')
  assert.equal(requests[0].init.method, 'GET')
  assert.equal(requests[1].url, 'https://github.example/api/v3/user/repos')
  assert.equal(requests[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    name: 'mindflow-sync',
    private: true,
    auto_init: true,
    default_branch: 'feature/sync'
  })
})

test('ensureRepo refuses an existing repository without write permission and gives PAT guidance', async () => {
  await withFetch(async () => jsonResponse({
    private: true,
    permissions: { push: false }
  }), async () => {
    const { ensureRepo, SyncHttpError } = await loadAdapter()

    await assert.rejects(ensureRepo(cfg), error => {
      assert.ok(error instanceof SyncHttpError)
      assert.equal(error.status, 403)
      assert.equal(error.retryable, false)
      assert.match(error.message, /Contents.*Read and write/i)
      return true
    })
  })
})

test('ensureRepo adds PAT guidance when GitHub rejects repository creation', async () => {
  let call = 0

  await withFetch(async () => {
    call += 1
    if (call === 1) return jsonResponse({ message: 'Not Found' }, { status: 404 })
    return jsonResponse({ message: 'Resource not accessible by personal access token' }, { status: 403 })
  }, async () => {
    const { ensureRepo } = await loadAdapter()

    await assert.rejects(ensureRepo(cfg), error => {
      assert.equal(error.status, 403)
      assert.match(error.message, /Contents.*Read and write/i)
      assert.doesNotMatch(error.message, /github_pat_secret/)
      return true
    })
  })
})

for (const [status, retryable] of [[401, false], [403, false], [404, false], [500, true], [503, true]]) {
  test(`classifies HTTP ${status} with retryable=${retryable}`, async () => {
    await withFetch(async () => jsonResponse({ message: `GitHub failure ${status}` }, { status }), async () => {
      const { getCommit, SyncHttpError } = await loadAdapter()

      await assert.rejects(getCommit(cfg, 'commit-sha'), error => {
        assert.ok(error instanceof SyncHttpError)
        assert.equal(error.status, status)
        assert.equal(error.retryable, retryable)
        assert.match(error.message, new RegExp(`GitHub failure ${status}`))
        assert.doesNotMatch(error.message, /github_pat_secret/)
        return true
      })
    })
  })
}

test('redacts the configured token when a GitHub error body echoes it', async () => {
  await withFetch(async () => jsonResponse({
    message: 'Bad credentials: github_pat_secret'
  }, { status: 401 }), async () => {
    const { getCommit } = await loadAdapter()

    await assert.rejects(getCommit(cfg, 'commit-sha'), error => {
      assert.match(error.message, /Bad credentials/i)
      assert.doesNotMatch(error.message, /github_pat_secret/)
      assert.doesNotMatch(String(error.cause), /github_pat_secret/)
      return true
    })
  })
})

test('classifies a fetch failure as retryable without leaking the token', async () => {
  await withFetch(async () => {
    throw new TypeError('network disconnected github_pat_secret')
  }, async () => {
    const { getCommit, SyncHttpError } = await loadAdapter()

    await assert.rejects(getCommit(cfg, 'commit-sha'), error => {
      assert.ok(error instanceof SyncHttpError)
      assert.equal(error.status, 0)
      assert.equal(error.retryable, true)
      assert.match(error.message, /network disconnected/i)
      assert.doesNotMatch(error.message, /github_pat_secret/)
      assert.doesNotMatch(String(error.cause), /github_pat_secret/)
      return true
    })
  })
})

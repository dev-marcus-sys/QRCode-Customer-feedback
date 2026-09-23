'use strict';
process.env.DB_PATH = ':memory:';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../src/db/connection');
const kbService = require('../src/services/kbService');

const db = initDatabase();

function setCfg(key, value) {
  db.prepare('UPDATE sys_config SET config_value = ? WHERE config_key = ?').run(JSON.stringify(value), key);
}
function setKb(key, value) { setCfg(key, value); }

const SAMPLE_MD = `# 保安服務指引

## 巡邏安排
保安員須每兩小時巡邏屋苑公共地方一次，並於巡邏記錄表簽署。

## 訪客管理
訪客須於大堂登記身分證明，由住戶確認方可進入。

# 維修事宜

## 漏水處理
發現漏水應即時截斷水源，並通知維修部於四小時內跟進。
`;

describe('AI-09 知識庫 chunkMarkdown', () => {
  test('按標題分塊並保留章節路徑', () => {
    const chunks = kbService.chunkMarkdown(SAMPLE_MD);
    assert.ok(chunks.length >= 4, '應至少分出 4 塊');
    const patrol = chunks.find((c) => c.heading === '巡邏安排');
    assert.ok(patrol, '應有「巡邏安排」塊');
    assert.deepEqual(patrol.headingPath, ['保安服務指引', '巡邏安排']);
    assert.ok(patrol.content.includes('巡邏記錄表'));
  });

  test('無標題內容亦成塊', () => {
    const chunks = kbService.chunkMarkdown('純文字沒有標題');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].heading, null);
  });
});

describe('AI-09 知識庫 ingest + search', () => {
  test('入庫後可檢索到相關段落（lexical 向量）', async () => {
    setKb('ai.kb.enabled', true);
    setKb('ai.kb.top_k', 3);
    setKb('ai.kb.threshold', 0.0);
    const ing = await kbService.ingestDocument(db, {
      title: '保安與維修指引', source: 'docs/手冊.md', version: '1', owner: 'admin', content: SAMPLE_MD,
    });
    const docs = kbService.listKbDocuments(db);
    assert.ok(docs.some((d) => d.docId === ing.docId && d.chunkCount === ing.chunkCount));

    const res = await kbService.searchKb(db, { query: '保安員巡邏安排' });
    assert.ok(res.count > 0, '應有檢索結果');
    assert.ok(
      res.results.some((r) => (r.headingPath || []).join(' ').includes('巡邏安排') || r.content.includes('巡邏')),
      '檢索結果應包含巡邏相關段落'
    );
    assert.ok(res.results.every((r) => r.docId === ing.docId));
  });

  test('停用文件不會出現在檢索結果', async () => {
    const ing = await kbService.ingestDocument(db, { title: '待停用', source: 'x', content: '# 標題\n一些關於垃圾清潔的內容' });
    kbService.setKbDocumentStatus(db, ing.docId, 'disabled');
    const res = await kbService.searchKb(db, { query: '垃圾清潔' });
    assert.ok(res.results.every((r) => r.docId !== ing.docId), '停用文件不應出現');
  });
});

describe('AI-09 知識庫 ask（無 LLM 回落）', () => {
  test('未啟用生成時回落檢索片段並附來源', async () => {
    setKb('ai.kb.answer_enabled', false);
    const res = await kbService.askKb(db, { query: '保安員巡邏安排', user: { userId: 1, username: 'admin' } });
    assert.equal(res.generated, false);
    assert.equal(res.fallback, true);
    assert.ok(res.citations.length > 0);
    assert.ok(res.answer.includes('相關段落'));
    const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action='AI_KB_QUERY'").get();
    assert.ok(audit.c > 0);
  });

  test('高門檻無命中時明確說無資料', async () => {
    const res = await kbService.askKb(db, { query: 'zzz 完全不相關的字串 qq', threshold: 0.9, user: { userId: 1, username: 'admin' } });
    assert.ok(res.answer.includes('未找到相關資料'));
  });
});

describe('AI-09 知識庫管理', () => {
  test('清單／狀態切換／刪除', async () => {
    const ing = await kbService.ingestDocument(db, { title: '管理測試', source: 'm', content: '# A\n內容' });
    assert.ok(kbService.listKbDocuments(db).some((d) => d.docId === ing.docId));
    const doc = kbService.setKbDocumentStatus(db, ing.docId, 'pending_review');
    assert.equal(doc.status, 'pending_review');
    const del = kbService.deleteKbDocument(db, ing.docId);
    assert.equal(del.deleted, true);
    assert.equal(kbService.getKbDocument(db, ing.docId), null);
  });
});

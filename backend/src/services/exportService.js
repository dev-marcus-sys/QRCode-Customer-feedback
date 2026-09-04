/**
 * 匯出服務（FR-003-05）：CSV（UTF-8 BOM）與 XLSX（exceljs）。
 * 套用與列表相同篩選（無分頁、上限 5000 筆）。
 */
'use strict';
const ExcelJS = require('exceljs');
const { listCases } = require('./caseService');
const { STATUS_META } = require('../config/constants');
const { hkToday } = require('../utils/time');

const HEADERS = [
  '個案編號', '來源', '狀態', '事件類型', '優先級', '意見性質', '事項類別', '屋苑',
  '稱謂', '姓名', '電話', '電郵', '座', '樓層', '單位',
  '事發日期', '事發時間', '意見內容', '二次投訴', '原案號', '處理人員',
  '提交時間', '首次回應到期', '關閉期限',
];

function toRow(item) {
  const statusZh = (STATUS_META[item.caseStatus] || {}).labelZh || item.caseStatus;
  return [
    item.caseId, item.caseSource, statusZh, item.eventType, item.priority, item.intentType,
    item.categoryCode, item.estateNameZh || item.estateCode,
    item.customerTitle, item.customerName, item.customerPhone || '', item.customerEmail || '',
    item.address.block || '', item.address.floor || '', item.address.unit || '',
    item.incidentDate, item.incidentTime || '', item.commentContent,
    item.isSecondComplaint ? '是' : '否', item.originalCaseId || '',
    item.assignedTo ? item.assignedTo.fullName : '',
    item.createdAt || '', item.responseSlaDue || '', item.closureSlaDue || '',
  ];
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(items) {
  const lines = [HEADERS.join(',')];
  for (const item of items) {
    lines.push(toRow(item).map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

async function buildXlsx(items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QRCode 客戶意見反饋系統';
  wb.created = new Date();
  const ws = wb.addWorksheet('cases');
  const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F9' } } };
  ws.addRow(HEADERS);
  ws.getRow(1).eachCell((cell) => {
    cell.font = headerStyle.font;
    cell.fill = headerStyle.fill;
  });
  for (const item of items) {
    ws.addRow(toRow(item));
  }
  ws.getColumn(1).width = 34;
  ws.getColumn(8).width = 12;
  ws.getColumn(18).width = 60;
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function hkStamp() {
  const hk = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${hk.getUTCFullYear()}${pad(hk.getUTCMonth() + 1)}${pad(hk.getUTCDate())}_${pad(hk.getUTCHours())}${pad(hk.getUTCMinutes())}`;
}

/**
 * @returns {Promise<{buffer:Buffer, ext:string, filename:string}>}
 */
async function exportFile(db, format, filters, user) {
  const { items } = listCases(db, filters, user, { noPaging: true });
  const ext = format === 'csv' ? 'csv' : 'xlsx';
  const filename = `feedback_cases_${hkStamp()}.${ext}`;
  const buffer = ext === 'csv' ? Buffer.from(buildCsv(items), 'utf8') : await buildXlsx(items);
  return { buffer, ext, filename };
}

module.exports = { exportFile };

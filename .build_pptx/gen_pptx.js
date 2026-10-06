const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const {
  MdQrCode2, MdSmartphone, MdAssignment, MdInsights,
  MdAdminPanelSettings, MdInstallMobile,
} = require("react-icons/md");

const OUT = "c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/docs/系統簡介.pptx";
const IMG = "c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/docs/assets/Flat_modern_vector_illustratio_2026-10-05T02-47-19.png";

// palette (matches the soft blue/teal illustration)
const C = {
  primary: "155E75",   // deep teal-blue header
  primaryDark: "0F4459",
  accent: "0E7490",
  teal: "14B8A6",
  textDark: "1F2A37",
  muted: "5B6B7A",
  lightStrip: "E0F2F5",
  white: "FFFFFF",
};
const FONT = "Microsoft JhengHei";

async function iconPng(Icon, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Icon, { color, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pres.title = "QR Code 客戶意見反饋系統簡介";

  const slide = pres.addSlide();
  slide.background = { color: "F7FAFC" };

  // ---------- header band ----------
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.0, fill: { color: C.primary },
  });
  // QR icon in white circle
  const qrWhite = await iconPng(MdQrCode2, "#155E75");
  slide.addShape(pres.shapes.OVAL, { x: 0.45, y: 0.26, w: 0.48, h: 0.48, fill: { color: C.white } });
  slide.addImage({ data: qrWhite, x: 0.56, y: 0.37, w: 0.26, h: 0.26 });

  slide.addText("QR Code 客戶意見反饋系統", {
    x: 1.08, y: 0, w: 5.9, h: 1.0, margin: 0,
    fontFace: FONT, fontSize: 26, bold: true, color: C.white,
    align: "left", valign: "middle",
  });
  slide.addText("住戶掃碼即反饋 · 後台全程跟進", {
    x: 6.6, y: 0, w: 2.95, h: 1.0, margin: 0,
    fontFace: FONT, fontSize: 12, color: "CDE9F0",
    align: "right", valign: "middle",
  });

  // ---------- left: illustration card ----------
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.45, y: 1.22, w: 3.95, h: 3.6, rectRadius: 0.08,
    fill: { color: C.white },
    shadow: { type: "outer", color: "9AB4C0", blur: 8, offset: 3, angle: 135, opacity: 0.35 },
  });
  slide.addImage({ path: IMG, x: 0.78, y: 1.37, w: 3.3, h: 3.3 });

  // ---------- right: feature rows ----------
  const features = [
    { icon: MdQrCode2, t: "QR Code 生成張貼", d: "為屋苑／設施產生專屬 QR Code，列印即用" },
    { icon: MdSmartphone, t: "住戶掃碼填寫", d: "免裝 App，手機開頁即提交意見" },
    { icon: MdAssignment, t: "個案自動管理", d: "自動開案、分派負責人、跟進狀態一覽" },
    { icon: MdInsights, t: "統計與報表", d: "滿意度趨勢、類別分佈，數據化決策" },
    { icon: MdAdminPanelSettings, t: "角色權限管控", d: "多屋苑多角色，資料存取安全分級" },
    { icon: MdInstallMobile, t: "手機 PWA 後台", d: "加到主畫面像 App，隨時隨地處理個案" },
  ];

  let y = 1.22;
  const rowH = 0.605;
  for (const f of features) {
    slide.addShape(pres.shapes.OVAL, {
      x: 4.72, y: y + 0.055, w: 0.42, h: 0.42, fill: { color: C.accent },
    });
    const data = await iconPng(f.icon, "#FFFFFF");
    slide.addImage({ data, x: 4.82, y: y + 0.155, w: 0.22, h: 0.22 });

    slide.addText(
      [
        { text: f.t, options: { bold: true, fontSize: 12.5, color: C.textDark, breakLine: true } },
        { text: f.d, options: { fontSize: 10, color: C.muted } },
      ],
      { x: 5.3, y: y, w: 4.25, h: rowH, margin: 0, fontFace: FONT, valign: "middle", align: "left" }
    );
    y += rowH;
  }

  // ---------- bottom flow strip ----------
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.45, y: 5.0, w: 9.1, h: 0.44, rectRadius: 0.08, fill: { color: C.lightStrip },
  });
  slide.addText("住戶掃碼   →   填寫意見   →   自動開案   →   分派跟進   →   統計分析", {
    x: 0.45, y: 5.0, w: 9.1, h: 0.44, margin: 0,
    fontFace: FONT, fontSize: 11.5, bold: true, color: C.primaryDark,
    align: "center", valign: "middle",
  });

  await pres.writeFile({ fileName: OUT });
  console.log("written:", OUT);
})().catch((e) => { console.error(e); process.exit(1); });

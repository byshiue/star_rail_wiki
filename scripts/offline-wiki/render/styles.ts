export const printStyles = `
@page { size: A4; margin: 18mm 16mm 20mm; }
:root { color-scheme: light; font-family: "Noto Sans CJK SC", "Source Han Sans SC", sans-serif; color: #172033; }
* { box-sizing: border-box; }
body { margin: 0; font-size: 10.5pt; line-height: 1.55; }
a { color: #315b9d; text-decoration: none; }
h1 { color: #263d78; font-size: 25pt; margin: 0 0 8mm; }
h2 { color: #263d78; border-bottom: 1px solid #b9c4d8; padding-bottom: 2mm; }
h3 { margin-bottom: 1.5mm; }
.cover { break-after: page; min-height: 230mm; display: grid; align-content: center; }
.entry { break-before: page; }
.entry:first-of-type { break-before: auto; }
.meta, .source, .missing, .footer { color: #5d6778; font-size: 9pt; }
.coverage { border-left: 3px solid #879cc0; padding: 2mm 3mm; background: #f4f7fb; }
.local-notice { border: 1px solid #d5a94e; padding: 2mm 3mm; color: #765614; background: #fff9e8; }
.lore-section { break-inside: avoid; margin: 4mm 0; padding-left: 3mm; border-left: 2px solid #d6deeb; }
.lore-body { overflow-wrap: anywhere; line-height: 1.7; }
.game-align { display: block; margin: 1.5mm 0; }
.game-align-center { text-align: center; }
.game-align-right { text-align: right; }
.game-nowrap, .game-icon { white-space: nowrap; }
.relationships { padding-left: 6mm; }
.image-placeholder { min-height: 38mm; border: 1px dashed #9ba8bd; display: grid; place-items: center; color: #6b7688; }
.entry-image { display: block; max-width: 100%; max-height: 110mm; margin: 3mm auto; object-fit: contain; }
.attribution { text-align: center; color: #6b7688; font-size: 8pt; }
.toc { columns: 2; column-gap: 10mm; }
.toc li { break-inside: avoid; margin-bottom: 1mm; }
.feature { break-inside: avoid; border-left: 2px solid #d6deeb; padding-left: 4mm; margin: 4mm 0; }
.source { border-top: 1px solid #dde3ec; margin-top: 6mm; padding-top: 2mm; overflow-wrap: anywhere; }
.return { text-align: right; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid #dde3ec; padding: 2mm; text-align: left; vertical-align: top; }
`;

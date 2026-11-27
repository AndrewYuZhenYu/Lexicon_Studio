(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.WordList = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MAX_ENTRIES = 100000;
    const WORD_HEADERS = /^(word|words|vocabulary|vocab|term|phrase|expression|english\s*word|word\s*\/\s*phrase|单词|词汇|词语|词条|英文|英文单词|英语单词|短语|生词|单词\s*\/\s*短语)$/i;
    const NOTE_HEADERS = /^(meaning|definition|translation|note|notes|chinese|中文|释义|中文释义(?:[（(]含词性[）)])?|翻译|意思|备注|释义\s*\/\s*备注|解释)$/i;
    const INDEX_HEADERS = /^(no\.?|number|index|序号|编号)$/i;
    const GROUP_HEADERS = /^(group|category|分类|分组)$/i;
    const MARK_HEADERS = /^(已标记|标记|marked)$/i;
    const FAVORITE_HEADERS = /^(已收藏|收藏|favorite|favourite)$/i;

    function clean(value) {
        return String(value ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
    }

    function normalizeWord(value) {
        return clean(value).replace(/^\d+[.)、]\s*/, '').replace(/^[-*•]\s*/, '')
            .replace(/^\*\*(.*?)\*\*$/, '$1').trim();
    }

    const TITLE_WORDS = /^(?:目录|词汇表|单词表|生词表|重点词汇|核心词汇|雅思词汇|托福词汇|词汇统计|使用说明|总计|阶段)$/i;
    const TITLE_PHRASES = /(?:^|[\s_-])(?:vocabulary|vocab|word)[\s_-]*(?:list|master|sheet|table)(?=$|[\s_-])|(?:^|[\s_-])(?:ielts|toefl)[\s_-]*(?:vocabulary|vocab|word)(?=$|[\s_-])/i;
    const SECTION_WORDS = /^(?:第[一二三四五六七八九十百\d]+[章节单元课组]|(?:unit|chapter|lesson|part|section|list|day)\s*[\d一二三四五六七八九十]+\b)/i;
    function usable(word, englishList = false) {
        if (!word || word.length > 200 || /^\d+$/.test(word) || !/[\p{L}]/u.test(word)) return false;
        if (/[。！？!?；;]/.test(word)) return false;
        if (englishList && !/[A-Za-z]/.test(word)) return false;
        return true;
    }

    function heading(word, note = '', group = '') {
        if (/^(?:使用说明|词汇统计|统计|目录|README)$/i.test(group)) return true;
        if (SECTION_WORDS.test(word)) return true;
        if ((TITLE_WORDS.test(word) || TITLE_PHRASES.test(word)) && (!note || /^\d+$/.test(note))) return true;
        if (WORD_HEADERS.test(word) && (!note || NOTE_HEADERS.test(note))) return true;
        return false;
    }

    function parseDelimited(text, delimiter) {
        const rows = [];
        let row = [], field = '', quoted = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (quoted) {
                if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
                else if (char === '"') quoted = false;
                else field += char;
            } else if (char === '"') quoted = true;
            else if (char === delimiter) { row.push(field); field = ''; }
            else if (char === '\n' || char === '\r') {
                if (char === '\r' && text[i + 1] === '\n') i++;
                row.push(field); rows.push(row); row = []; field = '';
            } else field += char;
        }
        row.push(field);
        if (row.some(cell => cell !== '') || rows.length === 0) rows.push(row);
        return rows;
    }

    function chooseColumns(rows) {
        const first = rows.findIndex(row => row.some(cell => clean(cell)));
        if (first < 0) return { word: 0, note: -1, group: -1, marked: -1, favorite: -1, start: rows.length };
        const headerIndex = rows.findIndex((row, index) => index >= first && index < first + 40 &&
            row.some(cell => WORD_HEADERS.test(clean(cell))) &&
            (index === first || row.filter(cell => clean(cell)).length > 1));
        if (headerIndex >= 0) {
            const heading = rows[headerIndex].map(clean);
            const word = heading.findIndex(cell => WORD_HEADERS.test(cell));
            const note = heading.findIndex((cell, index) => index !== word && NOTE_HEADERS.test(cell));
            return { word, note,
                group: heading.findIndex(cell => GROUP_HEADERS.test(cell)),
                marked: heading.findIndex(cell => MARK_HEADERS.test(cell)),
                favorite: heading.findIndex(cell => FAVORITE_HEADERS.test(cell)),
                start: headerIndex + 1 };
        }
        const samples = rows.slice(first, first + 80);
        const width = Math.min(12, Math.max(...samples.map(row => row.length)));
        let best = 0, bestScore = -Infinity;
        for (let column = 0; column < width; column++) {
            let score = 0;
            for (const row of samples) {
                const value = normalizeWord(row[column]);
                if (/^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,5}$/.test(value)) score += 4;
                else if (usable(value)) score += 1;
                if (/^\d+(?:[.,]\d+)?$/.test(value)) score -= 6;
                if (value.length > 75 || /[：:；;。]/.test(value)) score -= 3;
            }
            if (score > bestScore) { bestScore = score; best = column; }
        }
        return { word: best, note: -1, group: -1, marked: -1, favorite: -1, start: first };
    }

    function rowsToEntries(rows, group) {
        const columns = chooseColumns(rows);
        const entries = [];
        const candidates = rows.slice(columns.start).map(row => normalizeWord(row[columns.word])).filter(word =>
            word && !heading(word));
        const englishList = candidates.length > 0 && candidates.filter(word => /[A-Za-z]/.test(word)).length / candidates.length >= 0.6;
        for (const row of rows.slice(columns.start)) {
            const word = normalizeWord(row[columns.word]);
            if (!usable(word, englishList)) continue;
            const groupName = columns.group >= 0 ? clean(row[columns.group]) || group : group;
            const noteValue = columns.note >= 0 ? clean(row[columns.note]) : clean(row.find((cell, index) => index !== columns.word && clean(cell)));
            if (heading(word, noteValue, groupName)) continue;
            if (row.some(cell => WORD_HEADERS.test(clean(cell))) && row.some(cell => NOTE_HEADERS.test(clean(cell)))) continue;
            const excluded = new Set([columns.word, columns.group, columns.marked, columns.favorite]);
            const note = row.map((cell, index) =>
                excluded.has(index) || INDEX_HEADERS.test(clean(rows[columns.start - 1]?.[index])) ? '' : clean(cell)).filter(Boolean).join(' · ');
            entries.push({ word, note: note.slice(0, 300), group: groupName,
                marked: columns.marked >= 0 && /^(?:是|true|1|yes)$/i.test(clean(row[columns.marked])) });
            if (entries.length > MAX_ENTRIES) throw new Error('词条超过 100000 条，请拆分后导入');
        }
        return entries;
    }

    function parseCsv(text, name = '') {
        const firstLine = text.split(/\r?\n/).slice(0, 8).find(line => /[\t,;]/.test(line)) || '';
        const delimiter = ['\t', ',', ';'].sort((a, b) =>
            firstLine.split(b).length - firstLine.split(a).length)[0];
        return rowsToEntries(parseDelimited(text, delimiter), name);
    }

    function parseTxt(text, name = '') {
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        const nonempty = lines.filter(line => line.trim());
        const tabular = /^(?:word|单词|词汇|英文)\s*[,;\t]/i.test(nonempty[0] || '') ||
            (nonempty.length > 0 && nonempty.filter(line => line.includes('\t')).length > nonempty.length / 2);
        if (tabular) return parseCsv(text, name);
        const entries = [];
        let group = name;
        const englishList = nonempty.filter(line => /^[\d.)、*•\s-]*[A-Za-z]/.test(line)).length >= nonempty.length * 0.6;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^#{1,6}\s+/.test(trimmed)) { group = clean(trimmed.replace(/^#{1,6}\s+/, '')); continue; }
            let value = trimmed.replace(/^\d+[.)、]\s*/, '').replace(/^[-*•]\s*/, '');
            const parts = value.split(/\s+(?:—|–|－|[-])\s+|\t+|\s{2,}|\s*[：:]\s*|\s*\|\s*/);
            if (parts.length === 1 && /^[A-Za-z]/.test(value)) {
                const bilingual = value.match(/^(.+?)\s+([\u3400-\u9fff].*)$/);
                if (bilingual) parts.splice(0, 1, bilingual[1], bilingual[2]);
            }
            const word = normalizeWord(parts.shift());
            if (!usable(word, englishList)) continue;
            const note = clean(parts.join(' · ')).slice(0, 300);
            if (heading(word, note, group)) continue;
            entries.push({ word, note, group });
            if (entries.length > MAX_ENTRIES) throw new Error('词条超过 100000 条，请拆分后导入');
        }
        return entries;
    }

    function xml(text) {
        const document = new DOMParser().parseFromString(text, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) throw new Error('Excel 文件的 XML 内容无效');
        return document;
    }

    function tags(element, name) {
        return Array.from(element.getElementsByTagNameNS('*', name));
    }

    function zipPath(base, target) {
        const joined = target.startsWith('/') ? target.slice(1) : `${base}/${target}`;
        const parts = [];
        for (const part of joined.split('/')) {
            if (part === '..') parts.pop();
            else if (part && part !== '.') parts.push(part);
        }
        return parts.join('/');
    }

    function parseXlsx(buffer, name = '') {
        if (!globalThis.fflate?.unzipSync) throw new Error('Excel 解析器未加载');
        let expanded = 0;
        const files = globalThis.fflate.unzipSync(new Uint8Array(buffer), {
            filter: file => {
                if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(file.name)) return false;
                expanded += file.originalSize;
                if (file.originalSize > 60 * 1024 * 1024 || expanded > 120 * 1024 * 1024)
                    throw new Error('Excel 解压后的内容过大，请拆分后导入');
                return true;
            }
        });
        const decode = path => files[path] ? new TextDecoder().decode(files[path]) : '';
        const workbook = decode('xl/workbook.xml');
        if (!workbook) throw new Error('找不到 Excel 工作簿');
        const relationships = xml(decode('xl/_rels/workbook.xml.rels'));
        const paths = new Map(tags(relationships, 'Relationship').map(rel =>
            [rel.getAttribute('Id'), zipPath('xl', rel.getAttribute('Target') || '')]));
        const shared = decode('xl/sharedStrings.xml');
        const strings = shared ? tags(xml(shared), 'si').map(si =>
            tags(si, 't').map(node => node.textContent).join('')) : [];
        const entries = [];
        for (const sheet of tags(xml(workbook), 'sheet')) {
            const path = paths.get(sheet.getAttribute('r:id'));
            if (!path || !files[path]) continue;
            const group = clean(sheet.getAttribute('name')) || name;
            const document = xml(decode(path));
            const rows = [];
            for (const row of tags(document, 'row')) {
                const cells = [];
                let sequentialColumn = 0;
                for (const cell of Array.from(row.childNodes).filter(node => node.nodeType === 1 && node.localName === 'c')) {
                    const ref = cell.getAttribute('r') || '';
                    const letters = ref.match(/^[A-Z]+/i)?.[0];
                    let column = sequentialColumn;
                    if (letters) {
                        column = 0;
                        for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
                        column--;
                    }
                    sequentialColumn = column + 1;
                    if (column > 30) continue;
                    const type = cell.getAttribute('t');
                    const value = tags(cell, type === 'inlineStr' ? 't' : 'v')[0]?.textContent || '';
                    cells[column] = type === 's' ? strings[Number(value)] || '' : value;
                }
                if (cells.some(cell => clean(cell))) rows.push(cells);
                if (rows.length > MAX_ENTRIES * 2) throw new Error('单张工作表行数过多，请拆分后导入');
            }
            entries.push(...rowsToEntries(rows, group));
            if (entries.length > MAX_ENTRIES * 3) throw new Error('工作簿行数过多，请拆分后导入');
        }
        return preferDetailedSheets(entries);
    }

    function preferDetailedSheets(entries) {
        const isSummary = entry => /^(?:全部|总表|汇总|all\b|master\b|summary\b)/i.test(entry.group);
        const detailed = entries.filter(entry => !isSummary(entry));
        const detailedWords = new Set(detailed.map(entry => entry.word.toLocaleLowerCase()));
        const summaryOnly = entries.filter(entry => isSummary(entry) && !detailedWords.has(entry.word.toLocaleLowerCase()));
        return [...detailed, ...summaryOnly];
    }

    function dedupe(entries) {
        const seen = new Set();
        return entries.filter(entry => {
            const key = entry.word.toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function filterEntries(entries) {
        const groups = new Map();
        for (const entry of entries) {
            const group = clean(entry.group);
            if (heading(normalizeWord(entry.word), clean(entry.note), group)) continue;
            const stats = groups.get(group) || { count: 0, english: 0 };
            stats.count++;
            if (/[A-Za-z]/.test(entry.word)) stats.english++;
            groups.set(group, stats);
        }
        return entries.filter(entry => {
            const word = normalizeWord(entry.word);
            const stats = groups.get(clean(entry.group));
            return usable(word, stats && stats.english / stats.count >= 0.6) &&
                !heading(word, clean(entry.note), clean(entry.group));
        });
    }

    async function readText(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2));
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { return new TextDecoder('gb18030').decode(bytes); }
    }

    async function parseFile(file) {
        if (file.size > 30 * 1024 * 1024) throw new Error('文件超过 30 MB，请拆分后导入');
        const extension = file.name.split('.').pop().toLowerCase();
        let entries;
        if (extension === 'xlsx') entries = parseXlsx(await file.arrayBuffer(), file.name);
        else if (extension === 'csv') entries = parseCsv(await readText(file), file.name);
        else if (extension === 'txt') entries = parseTxt(await readText(file), file.name);
        else throw new Error('请选择 .xlsx、.csv 或 .txt 文件');
        entries = dedupe(filterEntries(entries));
        if (entries.length > MAX_ENTRIES) throw new Error('词条超过 100000 条，请拆分后导入');
        if (!entries.length) throw new Error('没有找到可导入的词条，请检查第一列或表头');
        return entries;
    }

    function exportRows(entries, favorites = {}, options = {}) {
        const history = !!options.includeVocabularyHistory;
        const headings = ['单词', '释义/备注', '分组', '已标记', '已收藏'];
        if (history) headings.push('首次加入时间', '来源词表');
        const recordedAt = value => Number.isFinite(value) && value > 0
            ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return [headings, ...entries.map(entry => {
            const row = [entry.word, entry.note || '', entry.group || '', entry.marked ? '是' : '否',
                Object.prototype.hasOwnProperty.call(favorites, entry.word.toLocaleLowerCase()) ? '是' : '否'];
            if (history) row.push(recordedAt(entry.savedAt || entry.createdAt),
                (Array.isArray(entry.sources) ? entry.sources : []).map(source => source?.listName || '').filter(Boolean).join('、'));
            return row;
        })];
    }

    function exportCsv(entries, favorites, options) {
        const csvCell = value => {
            let text = String(value ?? '');
            if (/^[\s\t]*[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        };
        return '\uFEFF' + exportRows(entries, favorites, options).map(row => row.map(csvCell).join(',')).join('\r\n');
    }

    function exportXlsx(entries, favorites, options) {
        if (!globalThis.fflate?.zipSync) throw new Error('Excel 导出器未加载');
        const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const rows = exportRows(entries, favorites, options);
        const letter = index => String.fromCharCode(65 + index);
        const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
            rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">` + row.map((cell, column) =>
                `<c r="${letter(column)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(cell)}</t></is></c>`).join('') + '</row>').join('') +
            '</sheetData></worksheet>';
        const encoder = new TextEncoder();
        const files = {
            '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
            '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
            'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="单词表" sheetId="1" r:id="rId1"/></sheets></workbook>`,
            'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
            'xl/worksheets/sheet1.xml': sheet
        };
        return globalThis.fflate.zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, encoder.encode(value)])));
    }

    return { parseDelimited, parseCsv, parseTxt, parseXlsx, parseFile, dedupe, filterEntries, preferDetailedSheets, exportCsv, exportXlsx };
});

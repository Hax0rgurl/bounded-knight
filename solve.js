export function run(input) {
  const text = String(input.text);
  const length = text.length;
  const header = input.header === true;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = 0;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let unclosedSuffix = length; // Start of the first failed quote search.

  while (pos < length) {
    const recordLine = line;
    const row = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;

    for (;;) {
      quoted = text.charCodeAt(pos) === 34;
      let value = '';
      let closed = false;

      if (quoted) {
        const start = ++pos;
        let limit = length;
        if (start > unclosedSuffix) {
          // All later quote runs occur in pairs. Only the rest of the
          // opening run can contain a closer.
          limit = start;
          while (text.charCodeAt(limit) === 34) limit++;
        }

        let segment = start;
        let breaks = 0;
        for (let i = start; i < limit; i++) {
          const code = text.charCodeAt(i);
          if (code === 34) {
            if (text.charCodeAt(i + 1) !== 34) {
              value += text.slice(segment, i);
              pos = i + 1;
              line += breaks;
              closed = true;
              break;
            }
            value += text.slice(segment, i) + '"';
            segment = i + 2;
            i++;
          } else if (code === 10) {
            breaks++;
          } else if (code === 13) {
            value += text.slice(segment, i) + '\n';
            breaks++;
            if (text.charCodeAt(i + 1) === 10) i++;
            segment = i + 1;
          }
        }
        if (!closed) {
          // Replay from after the opener, with its literal value and original line.
          unclosedSuffix = Math.min(unclosedSuffix, start);
          errors.push({ code: 'unterminated_quote', line: recordLine, row });
          value = '"';
        }
      }

      let segment = pos;
      let added = false;
      let delimiter = 0;
      while (pos < length) {
        const code = text.charCodeAt(pos);
        if (code === 44 || code === 10) {
          delimiter = code;
          break;
        }
        if (code === 13) {
          if (text.charCodeAt(pos + 1) === 10) {
            delimiter = code;
            break;
          }
          if (pos > segment) {
            value += text.slice(segment, pos);
            added = true;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row });
          segment = pos + 1;
        }
        pos++;
      }

      if (pos > segment) {
        value += text.slice(segment, pos);
        added = true;
      }
      if (closed && added) errors.push({ code: 'quote_junk', line: recordLine, row });
      fields.push(value);

      if (delimiter === 44) {
        pos++;
        continue;
      }
      if (delimiter !== 0) {
        pos += delimiter === 13 ? 2 : 1;
        line++;
      }
      break;
    }

    // Empty lines and lines made solely of dropped CRs leave no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width === 0) width = fields.length;
    if (row === null) {
      columns = fields;
      continue;
    }

    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}

const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('src/curves.ts', 'utf8');
const sf = ts.createSourceFile('curves.ts', src, ts.ScriptTarget.ES2022, true);
for (const st of sf.statements) {
  if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue;
  if (!ts.isArrayLiteralExpression(st.expression.right)) continue;
  const arr = st.expression.right;
  console.log('数组元素数：' + arr.elements.length);
  arr.elements.forEach((el, n) => {
    const l = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
    console.log('  [' + (n + 1) + '] 行 ' + l + '  ' + el.getText(sf).replace(/\s+/g, ' ').slice(0, 60));
  });
  break;
}

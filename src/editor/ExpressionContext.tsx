export interface ExpressionContextProps {
  readonly scopeNames: readonly string[];
  readonly eventAllowed: boolean;
}

/** Read-only names from the caller's actual lexical context; never evaluates a value. */
export function ExpressionContext({ scopeNames, eventAllowed }: ExpressionContextProps) {
  const names = [...new Set(scopeNames)];
  return (
    <p className="editor-note">
      使用受支持的 JavaScript 表达式子集。可用：<code>state</code> / <code>forms</code> /{' '}
      <code>sources</code>
      {eventAllowed && (
        <>
          {' '}
          / <code>event</code>
        </>
      )}
      {names.length ? (
        <>
          ；当前循环或插槽参数：
          {names.map((name, index) => (
            <span key={name}>
              {index > 0 && ' / '}
              <code>{`scope[${JSON.stringify(name)}]`}</code>
            </span>
          ))}
          。
        </>
      ) : (
        '；当前没有循环或插槽参数。'
      )}
    </p>
  );
}

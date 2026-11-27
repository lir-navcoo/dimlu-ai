import { useRef } from 'react';
import {
  FieldFrame,
  useMaterialValue,
  arrayProp,
  boolProp,
  numberProp,
  requiredText,
  textProp,
  type Contracts,
  type FieldPresentation,
} from './shared';
import { textStyle } from './style';

export interface UploadMaterialProps extends FieldPresentation {
  value: string[];
  onValueChange?: (value: string[]) => void;
  accept?: string;
  multiple?: boolean;
  maxCount?: number;
}

/** Read selected files into data URLs so the value stays a JSON string array. */
export function readFiles(files: readonly File[]): Promise<string[]> {
  return Promise.all(
    Array.from(files).map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

const clampCount = (value: unknown) => {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 9;
  return Math.max(1, Math.min(50, count));
};

export function UploadMaterial({
  value,
  onValueChange,
  accept,
  multiple = false,
  maxCount = 9,
  ...field
}: UploadMaterialProps) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const input = useRef<HTMLInputElement>(null);
  const urls = Array.isArray(selected) ? selected.filter((v) => typeof v === 'string') : [];
  const limit = clampCount(maxCount);

  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <div className="material-upload" style={textStyle(field.style)}>
          <input
            ref={input}
            type="file"
            className="material-upload-input"
            accept={accept}
            multiple={multiple}
            disabled={field.disabled || field.readOnly || urls.length >= limit}
            aria-label={`${field.label}选择文件`}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (!files.length) return;
              void readFiles(multiple ? files : files.slice(0, 1)).then((next) => {
                change(multiple ? [...urls, ...next].slice(0, limit) : next);
                if (input.current) input.current.value = '';
              });
            }}
          />
          <button
            type="button"
            className="material-upload-trigger"
            disabled={field.disabled || field.readOnly || urls.length >= limit}
            onClick={() => input.current?.click()}
          >
            <span aria-hidden="true">＋</span>
            {urls.length ? '继续上传' : '上传附件'}
          </button>
          {!!urls.length && (
            <ul className="material-upload-list" {...a11y}>
              {urls.map((url, index) => (
                <li className="material-upload-item" key={`${index}:${url.slice(0, 32)}`}>
                  {url.startsWith('data:image/') ? (
                    <img className="material-upload-thumb" src={url} alt={`附件 ${index + 1}`} />
                  ) : (
                    <span className="material-upload-file">附件 {index + 1}</span>
                  )}
                  <button
                    type="button"
                    className="material-upload-remove"
                    aria-label={`移除附件 ${index + 1}`}
                    disabled={field.disabled || field.readOnly}
                    onClick={() => change(urls.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!urls.length && <small className="material-upload-empty">暂无附件</small>}
          <input
            type="hidden"
            name={field.name}
            value={JSON.stringify(urls)}
            readOnly
            aria-hidden="true"
          />
        </div>
      )}
    </FieldFrame>
  );
}

export const uploadContracts: Contracts = {
  'ui.upload': {
    version: '1.0.0',
    field: { type: 'array', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...arrayProp, required: true },
      accept: textProp,
      multiple: boolProp,
      maxCount: numberProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props, context) => {
      const errors: string[] = [];
      if (
        props.value !== undefined &&
        (!Array.isArray(props.value) || !props.value.every((v) => typeof v === 'string'))
      )
        errors.push('value 必须为文本数组');
      if (
        props.maxCount !== undefined &&
        (typeof props.maxCount !== 'number' || props.maxCount < 1)
      )
        errors.push('maxCount 必须为大于 0 的数字');
      if (context.fieldType && context.fieldType !== 'array')
        errors.push('附件上传需要绑定数组字段');
      return errors;
    },
  },
};

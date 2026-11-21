import { styleProperties } from './style.ts';
import { NODE_NAME_EXTENSION, nodeNameJsonSchema } from './node-name.ts';
// This schema is also exported as public/schema/application.v0.1.json during development.
export const applicationJsonSchema = {
  $id: 'https://dimlu.dev/schema/application/0.1.0',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'title', 'entryPageId', 'dependencies', 'pages'],
  properties: {
    schemaVersion: { const: '0.1.0' },
    id: { $ref: '#/$defs/id' },
    title: { type: 'string', minLength: 1 },
    entryPageId: { $ref: '#/$defs/id' },
    methods: { type: 'array', items: { $ref: '#/$defs/applicationMethod' } },
    extensions: { $ref: '#/$defs/extensions' },
    dependencies: {
      type: 'object',
      additionalProperties: false,
      required: ['components', 'actions'],
      properties: {
        components: { $ref: '#/$defs/dependencies' },
        actions: { $ref: '#/$defs/dependencies' },
        computations: { $ref: '#/$defs/dependencies' },
        transports: { $ref: '#/$defs/dependencies' },
      },
    },
    pages: { type: 'array', minItems: 1, items: { $ref: '#/$defs/page' } },
  },
  $defs: {
    id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_.-]*$' },
    json: {
      anyOf: [
        { type: ['null', 'boolean', 'string', 'number'] },
        { type: 'array', items: { $ref: '#/$defs/json' } },
        {
          type: 'object',
          propertyNames: { not: { enum: ['__proto__', 'prototype', 'constructor'] } },
          additionalProperties: { $ref: '#/$defs/json' },
        },
      ],
    },
    dependencies: {
      type: 'object',
      propertyNames: { $ref: '#/$defs/id' },
      additionalProperties: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    },
    extensions: {
      type: 'object',
      propertyNames: { pattern: '^[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z][a-zA-Z0-9_.-]*$' },
      additionalProperties: { $ref: '#/$defs/json' },
    },
    nodeExtensions: {
      allOf: [
        { $ref: '#/$defs/extensions' },
        { properties: { [NODE_NAME_EXTENSION]: nodeNameJsonSchema } },
      ],
    },
    values: {
      type: 'object',
      propertyNames: { not: { enum: ['__proto__', 'prototype', 'constructor'] } },
      additionalProperties: { $ref: '#/$defs/value' },
    },
    value: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'sourceId'],
          properties: {
            kind: { const: 'dataRef' },
            sourceId: { $ref: '#/$defs/id' },
            path: {
              type: 'array',
              items: { type: 'string', not: { enum: ['__proto__', 'prototype', 'constructor'] } },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'formId', 'fieldId'],
          properties: {
            kind: { const: 'fieldRef' },
            formId: { $ref: '#/$defs/id' },
            fieldId: { $ref: '#/$defs/id' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'formId'],
          properties: { kind: { const: 'formValues' }, formId: { $ref: '#/$defs/id' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'value'],
          properties: { kind: { const: 'literal' }, value: { $ref: '#/$defs/json' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'stateId'],
          properties: {
            kind: { const: 'stateRef' },
            stateId: { $ref: '#/$defs/id' },
            path: {
              type: 'array',
              items: { type: 'string', not: { enum: ['__proto__', 'prototype', 'constructor'] } },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'language', 'source'],
          properties: {
            kind: { const: 'expression' },
            language: { const: 'javascript' },
            source: { type: 'string', minLength: 1, maxLength: 4096 },
          },
        },
      ],
    },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'action', 'input'],
      properties: {
        id: { $ref: '#/$defs/id' },
        action: { $ref: '#/$defs/id' },
        input: { $ref: '#/$defs/values' },
        resultTo: { $ref: '#/$defs/id' },
      },
    },
    applicationMethod: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'source'],
      properties: {
        id: { $ref: '#/$defs/id' },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        inputType: { enum: ['string', 'number', 'boolean', 'array', 'object', 'null', 'json'] },
        outputType: { enum: ['string', 'number', 'boolean', 'array', 'object', 'null', 'json'] },
        source: { type: 'string', minLength: 1, maxLength: 32768 },
      },
    },
    actions: { type: 'array', items: { $ref: '#/$defs/action' } },
    rule: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'message'],
          properties: {
            kind: { enum: ['required', 'mustBeTrue'] },
            message: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'value', 'message'],
          properties: {
            kind: { enum: ['min', 'max', 'minLength', 'maxLength'] },
            value: { type: 'number' },
            message: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'value', 'message'],
          properties: {
            kind: { const: 'pattern' },
            value: { type: 'string', maxLength: 256 },
            message: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'test', 'message'],
          properties: {
            kind: { const: 'expression' },
            test: { $ref: '#/$defs/value' },
            message: { type: 'string', minLength: 1 },
          },
        },
      ],
    },
    path: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
        not: { enum: ['__proto__', 'prototype', 'constructor'] },
      },
    },
    field: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'path', 'label', 'type', 'initial'],
      allOf: [
        {
          if: { properties: { type: { const: 'array' } } },
          then: { required: ['itemType'], properties: { initial: { type: 'array' } } },
          else: { not: { required: ['itemType'] } },
        },
      ],
      properties: {
        id: { $ref: '#/$defs/id' },
        path: { $ref: '#/$defs/path' },
        label: { type: 'string', minLength: 1 },
        type: { enum: ['string', 'number', 'boolean', 'array'] },
        itemType: { enum: ['string', 'number'] },
        uniqueItems: { type: 'boolean' },
        format: { enum: ['date', 'month', 'time', 'datetime-local'] },
        range: { type: 'boolean' },
        initial: {
          anyOf: [
            { type: ['string', 'number', 'boolean', 'null'] },
            { type: 'array', items: { type: ['string', 'number'] } },
          ],
        },
        rules: { type: 'array', items: { $ref: '#/$defs/rule' } },
        when: { $ref: '#/$defs/value' },
        disabled: { $ref: '#/$defs/value' },
      },
    },
    fieldArray: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'path', 'label', 'fields', 'initial'],
      properties: {
        id: { $ref: '#/$defs/id' },
        path: { $ref: '#/$defs/path' },
        label: { type: 'string', minLength: 1 },
        fields: { type: 'array', minItems: 1, items: { $ref: '#/$defs/field' } },
        initial: {
          type: 'array',
          items: { type: 'object', additionalProperties: { $ref: '#/$defs/json' } },
        },
        minItems: { type: 'integer', minimum: 0 },
        maxItems: { type: 'integer', minimum: 0 },
        when: { $ref: '#/$defs/value' },
        disabled: { $ref: '#/$defs/value' },
      },
    },
    form: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'fields'],
      properties: {
        id: { $ref: '#/$defs/id' },
        fields: { type: 'array', items: { $ref: '#/$defs/field' } },
        arrays: { type: 'array', items: { $ref: '#/$defs/fieldArray' } },
        computed: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'compute'],
            properties: { id: { $ref: '#/$defs/id' }, compute: { $ref: '#/$defs/id' } },
          },
        },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['test', 'message'],
            properties: {
              test: { $ref: '#/$defs/value' },
              message: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    node: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'component', 'props'],
      properties: {
        id: { $ref: '#/$defs/id' },
        component: { $ref: '#/$defs/id' },
        props: { $ref: '#/$defs/values' },
        style: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            styleProperties.map((key) => [key, { $ref: '#/$defs/value' }]),
          ),
        },
        formId: { $ref: '#/$defs/id' },
        field: {
          type: 'object',
          additionalProperties: false,
          required: ['formId', 'fieldId'],
          properties: { formId: { $ref: '#/$defs/id' }, fieldId: { $ref: '#/$defs/id' } },
        },
        children: { $ref: '#/$defs/nodes' },
        when: { $ref: '#/$defs/value' },
        extensions: { $ref: '#/$defs/nodeExtensions' },
        on: { type: 'object', additionalProperties: { $ref: '#/$defs/actions' } },
        slots: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['params', 'children'],
            properties: {
              params: { type: 'array', uniqueItems: true, items: { $ref: '#/$defs/id' } },
              children: { $ref: '#/$defs/nodes' },
            },
          },
        },
        repeat: {
          type: 'object',
          additionalProperties: false,
          required: ['items', 'item', 'key'],
          properties: {
            items: { $ref: '#/$defs/value' },
            item: { $ref: '#/$defs/id' },
            index: { $ref: '#/$defs/id' },
            key: { $ref: '#/$defs/value' },
          },
        },
      },
    },
    page: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'state', 'children'],
      properties: {
        id: { $ref: '#/$defs/id' },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        code: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'language', 'source', 'css'],
          properties: {
            enabled: { type: 'boolean' },
            language: { enum: ['jsx', 'tsx'] },
            source: { type: 'string' },
            css: { type: 'string' },
          },
        },
        forms: { type: 'array', items: { $ref: '#/$defs/form' } },
        dataSources: { type: 'array', items: { $ref: '#/$defs/dataSource' } },
        state: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'initial'],
            properties: {
              id: { $ref: '#/$defs/id' },
              type: { enum: ['string', 'number', 'boolean', 'array', 'object', 'null'] },
              initial: { $ref: '#/$defs/json' },
            },
          },
        },
        children: { $ref: '#/$defs/nodes' },
        onEnter: { $ref: '#/$defs/actions' },
        extensions: { $ref: '#/$defs/extensions' },
      },
    },
    dataSource: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'transport', 'input', 'initial'],
      properties: {
        id: { $ref: '#/$defs/id' },
        kind: { enum: ['query', 'mutation'] },
        transport: { $ref: '#/$defs/id' },
        input: { $ref: '#/$defs/values' },
        initial: { $ref: '#/$defs/json' },
      },
    },
  },
} as const;

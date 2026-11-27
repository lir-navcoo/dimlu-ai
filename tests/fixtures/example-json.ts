// 从 public/examples 迁移的示例应用（运行态不可达，仅测试 fixture）。

export const actionsExample = {
  "schemaVersion": "0.1.0",
  "id": "dimlu.actions",
  "title": "事件与动作示例",
  "entryPageId": "records",
  "dependencies": {
    "components": {
      "ui.text": "1.0.0",
      "ui.table": "1.0.0",
      "ui.button": "1.0.0",
      "ui.drawer": "1.0.0",
      "ui.form": "1.0.0",
      "ui.input": "1.0.0",
      "ui.formStatus": "1.0.0"
    },
    "actions": {
      "state.set": "1.0.0",
      "form.setValues": "1.0.0",
      "form.reset": "1.0.0",
      "form.submit": "1.0.0",
      "demo.saveRecord": "1.0.0",
      "ui.notify": "1.0.0"
    }
  },
  "pages": [
    {
      "id": "records",
      "title": "记录管理",
      "description": "表格 → 行作用域 → 抽屉表单 → 保存并更新列表",
      "state": [
        {
          "id": "records",
          "type": "array",
          "initial": [
            {
              "id": "r1",
              "name": "林知远",
              "department": "研发中心"
            },
            {
              "id": "r2",
              "name": "陈嘉宁",
              "department": "产品设计部"
            }
          ]
        },
        {
          "id": "selectedId",
          "type": "string",
          "initial": ""
        },
        {
          "id": "drawerOpen",
          "type": "boolean",
          "initial": false
        }
      ],
      "forms": [
        {
          "id": "edit",
          "fields": [
            {
              "id": "recordId",
              "path": [
                "id"
              ],
              "label": "记录ID",
              "type": "string",
              "initial": ""
            },
            {
              "id": "name",
              "path": [
                "name"
              ],
              "label": "姓名",
              "type": "string",
              "initial": "",
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写姓名"
                }
              ]
            },
            {
              "id": "department",
              "path": [
                "department"
              ],
              "label": "部门",
              "type": "string",
              "initial": "",
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写部门"
                }
              ]
            }
          ]
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "记录管理"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 22
            },
            "fontWeight": {
              "kind": "literal",
              "value": 700
            },
            "color": {
              "kind": "literal",
              "value": "#1e293b"
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.4
            },
            "marginBottom": {
              "kind": "literal",
              "value": 2
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "点击表格中的编辑。姓名包含“失败”可体验服务错误；右侧事件面板可修改动作。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 13
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.7
            }
          }
        },
        {
          "id": "records-table",
          "component": "ui.table",
          "props": {
            "data": {
              "kind": "stateRef",
              "stateId": "records"
            },
            "columns": {
              "kind": "literal",
              "value": [
                {
                  "key": "name",
                  "title": "姓名"
                },
                {
                  "key": "department",
                  "title": "部门"
                }
              ]
            },
            "rowKey": {
              "kind": "literal",
              "value": "id"
            },
            "selectionMode": {
              "kind": "literal",
              "value": "none"
            },
            "paginate": {
              "kind": "literal",
              "value": false
            }
          },
          "slots": {
            "actions": {
              "params": [
                "row",
                "index"
              ],
              "children": [
                {
                  "id": "edit-record",
                  "component": "ui.button",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "编辑"
                    },
                    "variant": {
                      "kind": "literal",
                      "value": "secondary"
                    },
                    "disabled": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "forms.edit.isSubmitting"
                    }
                  },
                  "on": {
                    "onClick": [
                      {
                        "id": "select-record",
                        "action": "state.set",
                        "input": {
                          "stateId": {
                            "kind": "literal",
                            "value": "selectedId"
                          },
                          "value": {
                            "kind": "expression",
                            "language": "javascript",
                            "source": "scope.row.id"
                          }
                        }
                      },
                      {
                        "id": "reset-editor",
                        "action": "form.reset",
                        "input": {
                          "formId": {
                            "kind": "literal",
                            "value": "edit"
                          }
                        }
                      },
                      {
                        "id": "prefill-editor",
                        "action": "form.setValues",
                        "input": {
                          "formId": {
                            "kind": "literal",
                            "value": "edit"
                          },
                          "values": {
                            "kind": "expression",
                            "language": "javascript",
                            "source": "scope.row"
                          }
                        }
                      },
                      {
                        "id": "open-editor",
                        "action": "state.set",
                        "input": {
                          "stateId": {
                            "kind": "literal",
                            "value": "drawerOpen"
                          },
                          "value": {
                            "kind": "literal",
                            "value": true
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          "id": "record-drawer",
          "component": "ui.drawer",
          "props": {
            "title": {
              "kind": "literal",
              "value": "编辑记录"
            },
            "description": {
              "kind": "literal",
              "value": "既支持表单内原生提交，也支持底部按钮通过 form.submit 提交。"
            },
            "open": {
              "kind": "stateRef",
              "stateId": "drawerOpen"
            },
            "triggerLabel": {
              "kind": "literal",
              "value": "编辑当前记录"
            },
            "width": {
              "kind": "literal",
              "value": 440
            },
            "showFooter": {
              "kind": "literal",
              "value": true
            }
          },
          "on": {
            "onOpenChange": [
              {
                "id": "toggle-editor",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "drawerOpen"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event"
                  }
                }
              }
            ]
          },
          "children": [
            {
              "id": "record-form",
              "component": "ui.form",
              "formId": "edit",
              "props": {},
              "on": {
                "onSubmit": [
                  {
                    "id": "save-record",
                    "action": "demo.saveRecord",
                    "input": {
                      "rows": {
                        "kind": "stateRef",
                        "stateId": "records"
                      },
                      "id": {
                        "kind": "stateRef",
                        "stateId": "selectedId"
                      },
                      "values": {
                        "kind": "formValues",
                        "formId": "edit"
                      }
                    },
                    "resultTo": "records"
                  },
                  {
                    "id": "saved-notice",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "记录已保存"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "success"
                      }
                    }
                  },
                  {
                    "id": "close-editor",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "drawerOpen"
                      },
                      "value": {
                        "kind": "literal",
                        "value": false
                      }
                    }
                  }
                ]
              },
              "children": [
                {
                  "id": "record-name",
                  "component": "ui.input",
                  "props": {
                    "placeholder": {
                      "kind": "literal",
                      "value": "请输入姓名"
                    }
                  },
                  "field": {
                    "formId": "edit",
                    "fieldId": "name"
                  }
                },
                {
                  "id": "record-department",
                  "component": "ui.input",
                  "props": {
                    "placeholder": {
                      "kind": "literal",
                      "value": "请输入部门"
                    }
                  },
                  "field": {
                    "formId": "edit",
                    "fieldId": "department"
                  }
                },
                {
                  "id": "record-status",
                  "component": "ui.formStatus",
                  "props": {
                    "formId": {
                      "kind": "literal",
                      "value": "edit"
                    }
                  }
                },
                {
                  "id": "save-record-button",
                  "component": "ui.button",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "保存记录"
                    },
                    "type": {
                      "kind": "literal",
                      "value": "submit"
                    },
                    "disabled": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "forms.edit.isSubmitting"
                    }
                  }
                }
              ]
            }
          ],
          "slots": {
            "footer": {
              "params": [],
              "children": [
                {
                  "id": "external-submit",
                  "component": "ui.button",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "提交表单"
                    },
                    "type": {
                      "kind": "literal",
                      "value": "button"
                    },
                    "disabled": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "forms.edit.isSubmitting"
                    }
                  },
                  "on": {
                    "onClick": [
                      {
                        "id": "external-submit-submit",
                        "action": "form.submit",
                        "input": {
                          "formId": {
                            "kind": "literal",
                            "value": "edit"
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} as const;

export const data_sourcesExample = {
  "schemaVersion": "0.1.0",
  "id": "dimlu.data-sources",
  "title": "数据源内核示例",
  "entryPageId": "query",
  "dependencies": {
    "components": {
      "ui.input": "1.0.0",
      "ui.button": "1.0.0",
      "ui.table": "1.0.0",
      "ui.text": "1.0.0"
    },
    "actions": {
      "data.execute": "1.0.0",
      "state.set": "1.0.0"
    },
    "transports": {
      "demo.peopleQuery": "1.0.0"
    }
  },
  "pages": [
    {
      "id": "query",
      "title": "数据源查询",
      "state": [
        {
          "id": "query",
          "type": "string",
          "initial": ""
        }
      ],
      "dataSources": [
        {
          "id": "people",
          "kind": "query",
          "transport": "demo.peopleQuery",
          "input": {
            "query": {
              "kind": "stateRef",
              "stateId": "query"
            }
          },
          "initial": {
            "rows": [],
            "total": 0
          }
        }
      ],
      "onEnter": [
        {
          "id": "enter-people",
          "action": "data.execute",
          "input": {
            "sourceId": {
              "kind": "literal",
              "value": "people"
            }
          }
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "数据源查询"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 22
            },
            "fontWeight": {
              "kind": "literal",
              "value": 700
            },
            "color": {
              "kind": "literal",
              "value": "#1e293b"
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.4
            },
            "marginBottom": {
              "kind": "literal",
              "value": 2
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "仅预览时进入页面查询；修改条件后显式点击查询。输入“失败”可体验错误与重试。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 13
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.7
            }
          }
        },
        {
          "id": "query-input",
          "component": "ui.input",
          "props": {
            "label": {
              "kind": "literal",
              "value": "查询条件"
            },
            "value": {
              "kind": "stateRef",
              "stateId": "query"
            },
            "placeholder": {
              "kind": "literal",
              "value": "姓名或部门"
            }
          },
          "on": {
            "onChange": [
              {
                "id": "update-query",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "query"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event.target.value"
                  }
                }
              }
            ]
          }
        },
        {
          "id": "query-button",
          "component": "ui.button",
          "props": {
            "label": {
              "kind": "literal",
              "value": "查询记录"
            }
          },
          "on": {
            "onClick": [
              {
                "id": "query-people",
                "action": "data.execute",
                "input": {
                  "sourceId": {
                    "kind": "literal",
                    "value": "people"
                  }
                }
              }
            ]
          }
        },
        {
          "id": "query-error",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.people.error ? sources.people.error.message : \"\""
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "query-table",
          "component": "ui.table",
          "props": {
            "data": {
              "kind": "dataRef",
              "sourceId": "people",
              "path": [
                "rows"
              ]
            },
            "columns": {
              "kind": "literal",
              "value": [
                {
                  "key": "name",
                  "title": "姓名"
                },
                {
                  "key": "department",
                  "title": "部门"
                }
              ]
            },
            "rowKey": {
              "kind": "literal",
              "value": "id"
            },
            "loading": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.people.loading"
            },
            "paginate": {
              "kind": "literal",
              "value": false
            }
          }
        }
      ]
    }
  ]
} as const;

export const server_recordsExample = {
  "schemaVersion": "0.1.0",
  "id": "dimlu.server-records",
  "title": "服务端列表与保存刷新",
  "entryPageId": "records",
  "dependencies": {
    "components": {
      "ui.layout": "1.0.0",
      "ui.input": "1.0.0",
      "ui.number": "1.0.0",
      "ui.button": "1.0.0",
      "ui.table": "1.0.0",
      "ui.pagination": "1.0.0",
      "ui.drawer": "1.0.0",
      "ui.form": "1.0.0",
      "ui.formStatus": "1.0.0",
      "ui.alert": "1.0.0",
      "ui.text": "1.0.0"
    },
    "actions": {
      "state.set": "1.0.0",
      "data.execute": "1.0.0",
      "form.reset": "1.0.0",
      "form.setValues": "1.0.0",
      "demo.saveRecordOnce": "1.0.0",
      "ui.notify": "1.0.0"
    },
    "transports": {
      "demo.recordsQuery": "1.0.0",
      "demo.recordSave": "1.0.0"
    }
  },
  "pages": [
    {
      "id": "records",
      "title": "服务端记录管理",
      "state": [
        {
          "id": "query",
          "type": "string",
          "initial": ""
        },
        {
          "id": "page",
          "type": "number",
          "initial": 1
        },
        {
          "id": "pageSize",
          "type": "number",
          "initial": 5
        },
        {
          "id": "sortKey",
          "type": "string",
          "initial": ""
        },
        {
          "id": "sortDirection",
          "type": "string",
          "initial": ""
        },
        {
          "id": "selectedId",
          "type": "string",
          "initial": ""
        },
        {
          "id": "drawerOpen",
          "type": "boolean",
          "initial": false
        },
        {
          "id": "saveCommitted",
          "type": "boolean",
          "initial": false
        }
      ],
      "forms": [
        {
          "id": "edit",
          "fields": [
            {
              "id": "recordId",
              "path": [
                "id"
              ],
              "label": "记录 ID",
              "type": "string",
              "initial": ""
            },
            {
              "id": "name",
              "path": [
                "name"
              ],
              "label": "姓名",
              "type": "string",
              "initial": "",
              "disabled": {
                "kind": "expression",
                "language": "javascript",
                "source": "state.saveCommitted"
              },
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写姓名"
                }
              ]
            },
            {
              "id": "department",
              "path": [
                "department"
              ],
              "label": "部门",
              "type": "string",
              "initial": "",
              "disabled": {
                "kind": "expression",
                "language": "javascript",
                "source": "state.saveCommitted"
              },
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写部门"
                }
              ]
            },
            {
              "id": "amount",
              "path": [
                "amount"
              ],
              "label": "金额",
              "type": "number",
              "initial": 0,
              "disabled": {
                "kind": "expression",
                "language": "javascript",
                "source": "state.saveCommitted"
              },
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写金额"
                },
                {
                  "kind": "min",
                  "value": 0,
                  "message": "金额不能小于零"
                }
              ]
            }
          ]
        }
      ],
      "dataSources": [
        {
          "id": "records",
          "kind": "query",
          "transport": "demo.recordsQuery",
          "input": {
            "query": {
              "kind": "stateRef",
              "stateId": "query"
            },
            "page": {
              "kind": "stateRef",
              "stateId": "page"
            },
            "pageSize": {
              "kind": "stateRef",
              "stateId": "pageSize"
            },
            "sortKey": {
              "kind": "stateRef",
              "stateId": "sortKey"
            },
            "sortDirection": {
              "kind": "stateRef",
              "stateId": "sortDirection"
            }
          },
          "initial": {
            "items": [],
            "total": 0,
            "page": 1,
            "pageSize": 5,
            "sort": null
          }
        },
        {
          "id": "saveRecord",
          "kind": "mutation",
          "transport": "demo.recordSave",
          "input": {
            "id": {
              "kind": "stateRef",
              "stateId": "selectedId"
            },
            "values": {
              "kind": "formValues",
              "formId": "edit"
            }
          },
          "initial": {
            "id": ""
          }
        }
      ],
      "onEnter": [
        {
          "id": "enter-query",
          "action": "data.execute",
          "input": {
            "sourceId": {
              "kind": "literal",
              "value": "records"
            }
          }
        },
        {
          "id": "enter-page",
          "action": "state.set",
          "input": {
            "stateId": {
              "kind": "literal",
              "value": "page"
            },
            "value": {
              "kind": "dataRef",
              "sourceId": "records",
              "path": [
                "page"
              ]
            }
          }
        },
        {
          "id": "enter-size",
          "action": "state.set",
          "input": {
            "stateId": {
              "kind": "literal",
              "value": "pageSize"
            },
            "value": {
              "kind": "dataRef",
              "sourceId": "records",
              "path": [
                "pageSize"
              ]
            }
          }
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "服务端记录管理"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 22
            },
            "fontWeight": {
              "kind": "literal",
              "value": 700
            },
            "color": {
              "kind": "literal",
              "value": "#1e293b"
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.4
            },
            "marginBottom": {
              "kind": "literal",
              "value": 2
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "查询、分页、排序由本地 mock 服务执行。搜索“查询失败”验证重试；编辑姓名为“保存失败”或“刷新失败”验证两类错误。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          },
          "style": {
            "fontSize": {
              "kind": "literal",
              "value": 13
            },
            "lineHeight": {
              "kind": "literal",
              "value": 1.7
            }
          }
        },
        {
          "id": "query-filter",
          "component": "ui.input",
          "props": {
            "label": {
              "kind": "literal",
              "value": "搜索姓名或部门"
            },
            "value": {
              "kind": "stateRef",
              "stateId": "query"
            },
            "placeholder": {
              "kind": "literal",
              "value": "输入后点击搜索，不自动请求"
            }
          },
          "on": {
            "onChange": [
              {
                "id": "update-filter",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "query"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event.target.value"
                  }
                }
              }
            ]
          }
        },
        {
          "id": "query-actions",
          "component": "ui.layout",
          "props": {
            "variant": {
              "kind": "literal",
              "value": "row"
            }
          },
          "children": [
            {
              "id": "search-button",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "搜索"
                }
              },
              "on": {
                "onClick": [
                  {
                    "id": "search-first-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "literal",
                        "value": 1
                      }
                    }
                  },
                  {
                    "id": "search-query",
                    "action": "data.execute",
                    "input": {
                      "sourceId": {
                        "kind": "literal",
                        "value": "records"
                      }
                    }
                  },
                  {
                    "id": "search-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "page"
                        ]
                      }
                    }
                  },
                  {
                    "id": "search-size",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "pageSize"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "pageSize"
                        ]
                      }
                    }
                  }
                ]
              }
            },
            {
              "id": "clear-button",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "清空筛选"
                }
              },
              "on": {
                "onClick": [
                  {
                    "id": "clear-filter-value",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "query"
                      },
                      "value": {
                        "kind": "literal",
                        "value": ""
                      }
                    }
                  },
                  {
                    "id": "clear-first-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "literal",
                        "value": 1
                      }
                    }
                  },
                  {
                    "id": "clear-query",
                    "action": "data.execute",
                    "input": {
                      "sourceId": {
                        "kind": "literal",
                        "value": "records"
                      }
                    }
                  },
                  {
                    "id": "clear-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "page"
                        ]
                      }
                    }
                  },
                  {
                    "id": "clear-size",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "pageSize"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "pageSize"
                        ]
                      }
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          "id": "query-status",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.records.loading ? \"正在查询…\" : \"共 \" + sources.records.data.total + \" 条记录\""
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "records-table",
          "component": "ui.table",
          "props": {
            "data": {
              "kind": "dataRef",
              "sourceId": "records",
              "path": [
                "items"
              ]
            },
            "columns": {
              "kind": "literal",
              "value": [
                {
                  "key": "name",
                  "title": "姓名",
                  "sortable": true
                },
                {
                  "key": "department",
                  "title": "部门",
                  "sortable": true
                },
                {
                  "key": "amount",
                  "title": "金额",
                  "sortable": true,
                  "align": "right"
                }
              ]
            },
            "rowKey": {
              "kind": "literal",
              "value": "id"
            },
            "sort": {
              "kind": "dataRef",
              "sourceId": "records",
              "path": [
                "sort"
              ]
            },
            "sortMode": {
              "kind": "literal",
              "value": "server"
            },
            "paginate": {
              "kind": "literal",
              "value": false
            },
            "loading": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.records.loading"
            },
            "error": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.records.error ? sources.records.error.message : \"\""
            }
          },
          "on": {
            "onSortChange": [
              {
                "id": "sort-key",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "sortKey"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event ? event.key : \"\""
                  }
                }
              },
              {
                "id": "sort-direction",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "sortDirection"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event ? event.direction : \"\""
                  }
                }
              },
              {
                "id": "sort-first-page",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "page"
                  },
                  "value": {
                    "kind": "literal",
                    "value": 1
                  }
                }
              },
              {
                "id": "sort-query",
                "action": "data.execute",
                "input": {
                  "sourceId": {
                    "kind": "literal",
                    "value": "records"
                  }
                }
              },
              {
                "id": "sort-page",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "page"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "page"
                    ]
                  }
                }
              },
              {
                "id": "sort-size",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "pageSize"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "pageSize"
                    ]
                  }
                }
              }
            ],
            "onRetry": [
              {
                "id": "retry-list-query",
                "action": "data.execute",
                "input": {
                  "sourceId": {
                    "kind": "literal",
                    "value": "records"
                  }
                }
              },
              {
                "id": "retry-list-page",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "page"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "page"
                    ]
                  }
                }
              },
              {
                "id": "retry-list-size",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "pageSize"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "pageSize"
                    ]
                  }
                }
              }
            ]
          },
          "slots": {
            "actions": {
              "params": [
                "row",
                "index"
              ],
              "children": [
                {
                  "id": "edit-record",
                  "component": "ui.button",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "编辑"
                    },
                    "disabled": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "forms.edit.isSubmitting"
                    }
                  },
                  "on": {
                    "onClick": [
                      {
                        "id": "edit-marker",
                        "action": "state.set",
                        "input": {
                          "stateId": {
                            "kind": "literal",
                            "value": "saveCommitted"
                          },
                          "value": {
                            "kind": "literal",
                            "value": false
                          }
                        }
                      },
                      {
                        "id": "edit-id",
                        "action": "state.set",
                        "input": {
                          "stateId": {
                            "kind": "literal",
                            "value": "selectedId"
                          },
                          "value": {
                            "kind": "expression",
                            "language": "javascript",
                            "source": "scope.row.id"
                          }
                        }
                      },
                      {
                        "id": "edit-reset",
                        "action": "form.reset",
                        "input": {
                          "formId": {
                            "kind": "literal",
                            "value": "edit"
                          }
                        }
                      },
                      {
                        "id": "edit-prefill",
                        "action": "form.setValues",
                        "input": {
                          "formId": {
                            "kind": "literal",
                            "value": "edit"
                          },
                          "values": {
                            "kind": "expression",
                            "language": "javascript",
                            "source": "scope.row"
                          }
                        }
                      },
                      {
                        "id": "edit-open",
                        "action": "state.set",
                        "input": {
                          "stateId": {
                            "kind": "literal",
                            "value": "drawerOpen"
                          },
                          "value": {
                            "kind": "literal",
                            "value": true
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          "id": "records-pagination",
          "component": "ui.pagination",
          "props": {
            "page": {
              "kind": "stateRef",
              "stateId": "page"
            },
            "pageSize": {
              "kind": "stateRef",
              "stateId": "pageSize"
            },
            "total": {
              "kind": "dataRef",
              "sourceId": "records",
              "path": [
                "total"
              ]
            },
            "disabled": {
              "kind": "expression",
              "language": "javascript",
              "source": "sources.records.loading"
            }
          },
          "on": {
            "onPaginationChange": [
              {
                "id": "pagination-request-page",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "page"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event.page"
                  }
                }
              },
              {
                "id": "pagination-request-size",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "pageSize"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event.pageSize"
                  }
                }
              },
              {
                "id": "pagination-query",
                "action": "data.execute",
                "input": {
                  "sourceId": {
                    "kind": "literal",
                    "value": "records"
                  }
                }
              },
              {
                "id": "pagination-page",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "page"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "page"
                    ]
                  }
                }
              },
              {
                "id": "pagination-size",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "pageSize"
                  },
                  "value": {
                    "kind": "dataRef",
                    "sourceId": "records",
                    "path": [
                      "pageSize"
                    ]
                  }
                }
              }
            ]
          }
        },
        {
          "id": "edit-drawer",
          "component": "ui.drawer",
          "props": {
            "title": {
              "kind": "literal",
              "value": "编辑服务端记录"
            },
            "description": {
              "kind": "literal",
              "value": "保存成功后只刷新列表；刷新失败可以单独重试，无需再次保存。"
            },
            "open": {
              "kind": "stateRef",
              "stateId": "drawerOpen"
            },
            "triggerLabel": {
              "kind": "literal",
              "value": "继续当前编辑"
            },
            "showFooter": {
              "kind": "literal",
              "value": false
            },
            "width": {
              "kind": "literal",
              "value": 460
            }
          },
          "on": {
            "onOpenChange": [
              {
                "id": "drawer-toggle",
                "action": "state.set",
                "input": {
                  "stateId": {
                    "kind": "literal",
                    "value": "drawerOpen"
                  },
                  "value": {
                    "kind": "expression",
                    "language": "javascript",
                    "source": "event"
                  }
                }
              }
            ]
          },
          "children": [
            {
              "id": "refresh-warning",
              "component": "ui.alert",
              "when": {
                "kind": "expression",
                "language": "javascript",
                "source": "state.saveCommitted && !!sources.records.error"
              },
              "props": {
                "title": {
                  "kind": "literal",
                  "value": "保存已完成，仅列表刷新失败"
                },
                "description": {
                  "kind": "literal",
                  "value": "记录已经写入服务，请点击“仅重试刷新”，不会再次保存。"
                },
                "tone": {
                  "kind": "literal",
                  "value": "warning"
                }
              }
            },
            {
              "id": "retry-refresh",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "仅重试刷新"
                },
                "disabled": {
                  "kind": "expression",
                  "language": "javascript",
                  "source": "sources.records.loading || forms.edit.isSubmitting"
                }
              },
              "on": {
                "onClick": [
                  {
                    "id": "retry-saved-refresh-query",
                    "action": "data.execute",
                    "input": {
                      "sourceId": {
                        "kind": "literal",
                        "value": "records"
                      }
                    }
                  },
                  {
                    "id": "retry-saved-refresh-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "page"
                        ]
                      }
                    }
                  },
                  {
                    "id": "retry-saved-refresh-size",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "pageSize"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "pageSize"
                        ]
                      }
                    }
                  },
                  {
                    "id": "retry-saved-refresh-notice",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "记录已保存，列表已刷新"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "success"
                      }
                    }
                  },
                  {
                    "id": "retry-saved-refresh-close",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "drawerOpen"
                      },
                      "value": {
                        "kind": "literal",
                        "value": false
                      }
                    }
                  }
                ]
              },
              "when": {
                "kind": "expression",
                "language": "javascript",
                "source": "state.saveCommitted"
              }
            },
            {
              "id": "record-form",
              "component": "ui.form",
              "formId": "edit",
              "props": {},
              "on": {
                "onSubmit": [
                  {
                    "id": "save-record-once",
                    "action": "demo.saveRecordOnce",
                    "input": {}
                  },
                  {
                    "id": "save-committed",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "saveCommitted"
                      },
                      "value": {
                        "kind": "literal",
                        "value": true
                      }
                    }
                  },
                  {
                    "id": "save-refresh-query",
                    "action": "data.execute",
                    "input": {
                      "sourceId": {
                        "kind": "literal",
                        "value": "records"
                      }
                    }
                  },
                  {
                    "id": "save-refresh-page",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "page"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "page"
                        ]
                      }
                    }
                  },
                  {
                    "id": "save-refresh-size",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "pageSize"
                      },
                      "value": {
                        "kind": "dataRef",
                        "sourceId": "records",
                        "path": [
                          "pageSize"
                        ]
                      }
                    }
                  },
                  {
                    "id": "save-refresh-notice",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "记录已保存，列表已刷新"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "success"
                      }
                    }
                  },
                  {
                    "id": "save-refresh-close",
                    "action": "state.set",
                    "input": {
                      "stateId": {
                        "kind": "literal",
                        "value": "drawerOpen"
                      },
                      "value": {
                        "kind": "literal",
                        "value": false
                      }
                    }
                  }
                ]
              },
              "children": [
                {
                  "id": "edit-name",
                  "component": "ui.input",
                  "props": {},
                  "field": {
                    "formId": "edit",
                    "fieldId": "name"
                  }
                },
                {
                  "id": "edit-department",
                  "component": "ui.input",
                  "props": {},
                  "field": {
                    "formId": "edit",
                    "fieldId": "department"
                  }
                },
                {
                  "id": "edit-amount",
                  "component": "ui.number",
                  "props": {},
                  "field": {
                    "formId": "edit",
                    "fieldId": "amount"
                  }
                },
                {
                  "id": "edit-status",
                  "component": "ui.formStatus",
                  "props": {
                    "formId": {
                      "kind": "literal",
                      "value": "edit"
                    }
                  }
                },
                {
                  "id": "save-button",
                  "component": "ui.button",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "保存记录"
                    },
                    "type": {
                      "kind": "literal",
                      "value": "submit"
                    },
                    "disabled": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "forms.edit.isSubmitting || state.saveCommitted"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
} as const;

export const booleanExample = {
  "schemaVersion": "0.1.0",
  "id": "boolean-demo",
  "title": "布尔控件示例",
  "entryPageId": "boolean-demo",
  "dependencies": {
    "components": {
      "ui.button": "1.0.0",
      "ui.checkbox": "1.0.0",
      "ui.form": "1.0.0",
      "ui.formStatus": "1.0.0",
      "ui.switch": "1.0.0",
      "ui.text": "1.0.0"
    },
    "actions": {}
  },
  "pages": [
    {
      "id": "boolean-demo",
      "title": "布尔控件示例",
      "state": [],
      "forms": [
        {
          "id": "preferences",
          "fields": [
            {
              "id": "agree",
              "path": [
                "agree"
              ],
              "label": "我已确认申请信息",
              "type": "boolean",
              "initial": false,
              "rules": [
                {
                  "kind": "mustBeTrue",
                  "message": "请先确认申请信息"
                }
              ]
            },
            {
              "id": "notify",
              "path": [
                "notify"
              ],
              "label": "接收进度通知",
              "type": "boolean",
              "initial": false,
              "rules": [
                {
                  "kind": "required",
                  "message": "通知设置不能为空"
                }
              ]
            }
          ]
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "布尔控件示例"
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "复选框与开关 · 原生值回调 · 布尔校验与重置"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "form",
          "component": "ui.form",
          "props": {},
          "formId": "preferences",
          "children": [
            {
              "id": "agree",
              "component": "ui.checkbox",
              "props": {
                "hint": {
                  "kind": "literal",
                  "value": "必须勾选后才可提交"
                }
              },
              "field": {
                "formId": "preferences",
                "fieldId": "agree"
              }
            },
            {
              "id": "notify",
              "component": "ui.switch",
              "props": {
                "hint": {
                  "kind": "literal",
                  "value": "关闭也是有效值，提交结果保留 false"
                }
              },
              "field": {
                "formId": "preferences",
                "fieldId": "notify"
              }
            },
            {
              "id": "submit",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "校验并提交"
                },
                "type": {
                  "kind": "literal",
                  "value": "submit"
                }
              }
            },
            {
              "id": "reset",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "重置表单"
                },
                "type": {
                  "kind": "literal",
                  "value": "reset"
                },
                "variant": {
                  "kind": "literal",
                  "value": "secondary"
                }
              }
            },
            {
              "id": "status",
              "component": "ui.formStatus",
              "props": {
                "formId": {
                  "kind": "literal",
                  "value": "preferences"
                }
              }
            }
          ]
        },
        {
          "id": "independent",
          "component": "ui.switch",
          "props": {
            "label": {
              "kind": "literal",
              "value": "独立开关"
            },
            "checked": {
              "kind": "literal",
              "value": false
            },
            "hint": {
              "kind": "literal",
              "value": "未绑定字段，同样可以在预览中操作"
            }
          }
        }
      ]
    }
  ]
} as const;

export const componentsExample = {
  "schemaVersion": "0.1.0",
  "id": "dimlu.components",
  "title": "基础组件示例",
  "entryPageId": "forms",
  "dependencies": {
    "components": {
      "ui.alert": "1.0.0",
      "ui.button": "1.0.0",
      "ui.card": "1.0.0",
      "ui.checkboxGroup": "1.0.0",
      "ui.date": "1.0.0",
      "ui.descriptions": "1.0.0",
      "ui.dialog": "1.0.0",
      "ui.divider": "1.0.0",
      "ui.drawer": "1.0.0",
      "ui.fieldArray": "1.0.0",
      "ui.form": "1.0.0",
      "ui.image": "1.0.0",
      "ui.input": "1.0.0",
      "ui.layout": "1.0.0",
      "ui.link": "1.0.0",
      "ui.list": "1.0.0",
      "ui.loading": "1.0.0",
      "ui.pagination": "1.0.0",
      "ui.radioGroup": "1.0.0",
      "ui.tabPanel": "1.0.0",
      "ui.table": "1.0.0",
      "ui.tabs": "1.0.0",
      "ui.text": "1.0.0",
      "ui.time": "1.0.0"
    },
    "actions": {
      "ui.notify": "1.0.0"
    }
  },
  "pages": [
    {
      "id": "forms",
      "title": "表单组件",
      "state": [],
      "forms": [
        {
          "id": "application",
          "fields": [
            {
              "id": "name",
              "path": [
                "name"
              ],
              "label": "申请人",
              "type": "string",
              "initial": "",
              "rules": [
                {
                  "kind": "required",
                  "message": "请填写申请人"
                }
              ]
            },
            {
              "id": "priority",
              "path": [
                "priority"
              ],
              "label": "优先级",
              "type": "string",
              "initial": "normal"
            },
            {
              "id": "channels",
              "path": [
                "channels"
              ],
              "label": "通知渠道",
              "type": "array",
              "itemType": "string",
              "initial": []
            },
            {
              "id": "date",
              "path": [
                "date"
              ],
              "label": "计划日期",
              "type": "string",
              "format": "date",
              "initial": "",
              "rules": [
                {
                  "kind": "required",
                  "message": "请选择计划日期"
                }
              ]
            },
            {
              "id": "period",
              "path": [
                "period"
              ],
              "label": "生效范围",
              "type": "array",
              "itemType": "string",
              "uniqueItems": false,
              "format": "date",
              "range": true,
              "initial": []
            },
            {
              "id": "time",
              "path": [
                "time"
              ],
              "label": "提醒时间",
              "type": "string",
              "format": "time",
              "initial": ""
            }
          ],
          "arrays": [
            {
              "id": "items",
              "path": [
                "items"
              ],
              "label": "申请明细",
              "fields": [
                {
                  "id": "name",
                  "path": [
                    "name"
                  ],
                  "label": "名称",
                  "type": "string",
                  "initial": "",
                  "rules": [
                    {
                      "kind": "required",
                      "message": "请填写名称"
                    }
                  ]
                },
                {
                  "id": "quantity",
                  "path": [
                    "quantity"
                  ],
                  "label": "数量",
                  "type": "number",
                  "initial": 1,
                  "rules": [
                    {
                      "kind": "min",
                      "value": 1,
                      "message": "数量至少为 1"
                    }
                  ]
                }
              ],
              "initial": [
                {
                  "name": "示例项目",
                  "quantity": 1
                }
              ],
              "minItems": 1,
              "maxItems": 5
            }
          ]
        }
      ],
      "children": [
        {
          "id": "form-heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "表单组件"
            }
          }
        },
        {
          "id": "form-heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "单选、多选、日期时间与通用明细，统一参与字段校验和重置。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "form-card",
          "component": "ui.card",
          "props": {
            "title": {
              "kind": "literal",
              "value": "创建申请"
            },
            "description": {
              "kind": "literal",
              "value": "预览模式下填写和提交"
            }
          },
          "children": [
            {
              "id": "application-form",
              "component": "ui.form",
              "props": {
                "columns": {
                  "kind": "literal",
                  "value": 1
                },
                "gap": {
                  "kind": "literal",
                  "value": 14
                },
                "labelLayout": {
                  "kind": "literal",
                  "value": "top"
                },
                "showErrors": {
                  "kind": "literal",
                  "value": true
                }
              },
              "children": [
                {
                  "id": "field-name",
                  "component": "ui.input",
                  "props": {},
                  "field": {
                    "formId": "application",
                    "fieldId": "name"
                  }
                },
                {
                  "id": "field-priority",
                  "component": "ui.radioGroup",
                  "props": {
                    "options": {
                      "kind": "literal",
                      "value": [
                        {
                          "label": "普通",
                          "value": "normal"
                        },
                        {
                          "label": "紧急",
                          "value": "urgent"
                        }
                      ]
                    }
                  },
                  "field": {
                    "formId": "application",
                    "fieldId": "priority"
                  }
                },
                {
                  "id": "field-channels",
                  "component": "ui.checkboxGroup",
                  "props": {
                    "options": {
                      "kind": "literal",
                      "value": [
                        {
                          "label": "站内",
                          "value": "inbox"
                        },
                        {
                          "label": "邮件",
                          "value": "email"
                        }
                      ]
                    }
                  },
                  "field": {
                    "formId": "application",
                    "fieldId": "channels"
                  }
                },
                {
                  "id": "field-date",
                  "component": "ui.date",
                  "props": {},
                  "field": {
                    "formId": "application",
                    "fieldId": "date"
                  }
                },
                {
                  "id": "field-period",
                  "component": "ui.date",
                  "props": {
                    "range": {
                      "kind": "literal",
                      "value": true
                    }
                  },
                  "field": {
                    "formId": "application",
                    "fieldId": "period"
                  }
                },
                {
                  "id": "field-time",
                  "component": "ui.time",
                  "props": {},
                  "field": {
                    "formId": "application",
                    "fieldId": "time"
                  }
                },
                {
                  "id": "form-divider",
                  "component": "ui.divider",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "申请明细"
                    }
                  }
                },
                {
                  "id": "items",
                  "component": "ui.fieldArray",
                  "props": {
                    "formId": {
                      "kind": "literal",
                      "value": "application"
                    },
                    "arrayId": {
                      "kind": "literal",
                      "value": "items"
                    }
                  }
                },
                {
                  "id": "form-actions",
                  "component": "ui.layout",
                  "props": {
                    "variant": {
                      "kind": "literal",
                      "value": "row"
                    },
                    "gap": {
                      "kind": "literal",
                      "value": 8
                    }
                  },
                  "children": [
                    {
                      "id": "submit",
                      "component": "ui.button",
                      "props": {
                        "label": {
                          "kind": "literal",
                          "value": "提交申请"
                        },
                        "type": {
                          "kind": "literal",
                          "value": "submit"
                        },
                        "variant": {
                          "kind": "literal",
                          "value": "primary"
                        }
                      }
                    },
                    {
                      "id": "reset",
                      "component": "ui.button",
                      "props": {
                        "label": {
                          "kind": "literal",
                          "value": "重置"
                        },
                        "type": {
                          "kind": "literal",
                          "value": "reset"
                        }
                      }
                    }
                  ]
                }
              ],
              "formId": "application",
              "on": {
                "onSubmit": [
                  {
                    "id": "saved",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "申请已提交"
                      },
                      "description": {
                        "kind": "literal",
                        "value": "表单校验通过，明细与日期已包含在提交载荷中。"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "success"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "id": "data",
      "title": "数据展示",
      "state": [],
      "children": [
        {
          "id": "data-heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "数据展示"
            }
          }
        },
        {
          "id": "data-heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "表格支持排序、当前页选择与具名行操作插槽。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "table-card",
          "component": "ui.card",
          "props": {
            "title": {
              "kind": "literal",
              "value": "项目列表"
            }
          },
          "children": [
            {
              "id": "table",
              "component": "ui.table",
              "props": {
                "data": {
                  "kind": "literal",
                  "value": [
                    {
                      "id": "item-1",
                      "name": "项目 01",
                      "status": "进行中",
                      "amount": 80
                    },
                    {
                      "id": "item-2",
                      "name": "项目 02",
                      "status": "已完成",
                      "amount": 160
                    },
                    {
                      "id": "item-3",
                      "name": "项目 03",
                      "status": "进行中",
                      "amount": 240
                    },
                    {
                      "id": "item-4",
                      "name": "项目 04",
                      "status": "已完成",
                      "amount": 320
                    },
                    {
                      "id": "item-5",
                      "name": "项目 05",
                      "status": "进行中",
                      "amount": 400
                    },
                    {
                      "id": "item-6",
                      "name": "项目 06",
                      "status": "已完成",
                      "amount": 480
                    },
                    {
                      "id": "item-7",
                      "name": "项目 07",
                      "status": "进行中",
                      "amount": 560
                    },
                    {
                      "id": "item-8",
                      "name": "项目 08",
                      "status": "已完成",
                      "amount": 640
                    },
                    {
                      "id": "item-9",
                      "name": "项目 09",
                      "status": "进行中",
                      "amount": 720
                    },
                    {
                      "id": "item-10",
                      "name": "项目 10",
                      "status": "已完成",
                      "amount": 800
                    },
                    {
                      "id": "item-11",
                      "name": "项目 11",
                      "status": "进行中",
                      "amount": 880
                    },
                    {
                      "id": "item-12",
                      "name": "项目 12",
                      "status": "已完成",
                      "amount": 960
                    }
                  ]
                },
                "columns": {
                  "kind": "literal",
                  "value": [
                    {
                      "key": "name",
                      "title": "名称"
                    },
                    {
                      "key": "status",
                      "title": "状态"
                    },
                    {
                      "key": "amount",
                      "title": "金额",
                      "sortable": true,
                      "align": "right"
                    }
                  ]
                },
                "rowKey": {
                  "kind": "literal",
                  "value": "id"
                },
                "selectionMode": {
                  "kind": "literal",
                  "value": "multiple"
                },
                "pageSize": {
                  "kind": "literal",
                  "value": 5
                },
                "paginate": {
                  "kind": "literal",
                  "value": true
                }
              },
              "slots": {
                "actions": {
                  "params": [
                    "row",
                    "index"
                  ],
                  "children": [
                    {
                      "id": "row-detail",
                      "component": "ui.button",
                      "props": {
                        "label": {
                          "kind": "literal",
                          "value": "查看详情"
                        }
                      },
                      "on": {
                        "onClick": [
                          {
                            "id": "view-row",
                            "action": "ui.notify",
                            "input": {
                              "title": {
                                "kind": "expression",
                                "language": "javascript",
                                "source": "scope.row.name"
                              },
                              "description": {
                                "kind": "expression",
                                "language": "javascript",
                                "source": "scope.row.status"
                              },
                              "tone": {
                                "kind": "literal",
                                "value": "info"
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          ]
        },
        {
          "id": "data-divider",
          "component": "ui.divider",
          "props": {
            "label": {
              "kind": "literal",
              "value": "其他展示"
            }
          }
        },
        {
          "id": "details",
          "component": "ui.descriptions",
          "props": {
            "items": {
              "kind": "literal",
              "value": [
                {
                  "label": "名称",
                  "value": "示例应用"
                },
                {
                  "label": "状态",
                  "value": "运行中"
                },
                {
                  "label": "记录数",
                  "value": 12
                },
                {
                  "label": "更新时间",
                  "value": "2026-11-08"
                }
              ]
            },
            "columns": {
              "kind": "literal",
              "value": 2
            }
          }
        },
        {
          "id": "list",
          "component": "ui.list",
          "props": {
            "data": {
              "kind": "literal",
              "value": [
                {
                  "id": "item-1",
                  "name": "项目 01",
                  "status": "进行中",
                  "amount": 80
                },
                {
                  "id": "item-2",
                  "name": "项目 02",
                  "status": "已完成",
                  "amount": 160
                },
                {
                  "id": "item-3",
                  "name": "项目 03",
                  "status": "进行中",
                  "amount": 240
                }
              ]
            },
            "rowKey": {
              "kind": "literal",
              "value": "id"
            },
            "columns": {
              "kind": "literal",
              "value": 3
            }
          },
          "slots": {
            "item": {
              "params": [
                "item",
                "index"
              ],
              "children": [
                {
                  "id": "list-title",
                  "component": "ui.text",
                  "props": {
                    "value": {
                      "kind": "expression",
                      "language": "javascript",
                      "source": "scope.item.name + ' · ' + scope.item.status"
                    }
                  }
                }
              ]
            }
          }
        },
        {
          "id": "pagination",
          "component": "ui.pagination",
          "props": {
            "page": {
              "kind": "literal",
              "value": 1
            },
            "pageSize": {
              "kind": "literal",
              "value": 10
            },
            "total": {
              "kind": "literal",
              "value": 78
            }
          }
        },
        {
          "id": "link",
          "component": "ui.link",
          "props": {
            "label": {
              "kind": "literal",
              "value": "查看 Base UI 文档"
            },
            "href": {
              "kind": "literal",
              "value": "https://base-ui.com/react/overview/quick-start"
            },
            "newTab": {
              "kind": "literal",
              "value": true
            }
          }
        }
      ]
    },
    {
      "id": "layout",
      "title": "布局容器",
      "state": [],
      "children": [
        {
          "id": "layout-heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "布局与容器"
            }
          }
        },
        {
          "id": "layout-heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "标签页保留内容状态；卡片支持头部和底部插槽。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "tabs",
          "component": "ui.tabs",
          "props": {
            "value": {
              "kind": "literal",
              "value": "overview"
            },
            "label": {
              "kind": "literal",
              "value": "页面内容"
            }
          },
          "children": [
            {
              "id": "tab-a",
              "component": "ui.tabPanel",
              "props": {
                "value": {
                  "kind": "literal",
                  "value": "overview"
                },
                "label": {
                  "kind": "literal",
                  "value": "概览"
                }
              },
              "children": [
                {
                  "id": "grid",
                  "component": "ui.layout",
                  "props": {
                    "variant": {
                      "kind": "literal",
                      "value": "grid"
                    },
                    "columns": {
                      "kind": "literal",
                      "value": 2
                    },
                    "gap": {
                      "kind": "literal",
                      "value": 16
                    }
                  },
                  "children": [
                    {
                      "id": "info-card",
                      "component": "ui.card",
                      "props": {
                        "title": {
                          "kind": "literal",
                          "value": "应用信息"
                        }
                      },
                      "children": [
                        {
                          "id": "card-details",
                          "component": "ui.descriptions",
                          "props": {
                            "items": {
                              "kind": "literal",
                              "value": [
                                {
                                  "label": "组件库",
                                  "value": "Base UI"
                                },
                                {
                                  "label": "图标",
                                  "value": "Lucide"
                                }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    {
                      "id": "image",
                      "component": "ui.image",
                      "props": {
                        "src": {
                          "kind": "literal",
                          "value": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0ODAiIGhlaWdodD0iMjQwIj48cmVjdCB3aWR0aD0iNDgwIiBoZWlnaHQ9IjI0MCIgZmlsbD0iI2VlZjJmZiIvPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9IjQwMCIgaGVpZ2h0PSIxNjAiIHJ4PSIxMiIgZmlsbD0iI2M3ZDJmZSIvPjx0ZXh0IHg9IjI0MCIgeT0iMTM1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIzMCIgZmlsbD0iIzQzMzhjYSI+RGltbHUgQ29tcG9uZW50czwvdGV4dD48L3N2Zz4="
                        },
                        "alt": {
                          "kind": "literal",
                          "value": "组件示例图"
                        },
                        "width": {
                          "kind": "literal",
                          "value": 480
                        },
                        "height": {
                          "kind": "literal",
                          "value": 240
                        },
                        "preview": {
                          "kind": "literal",
                          "value": true
                        }
                      }
                    }
                  ]
                }
              ]
            },
            {
              "id": "tab-b",
              "component": "ui.tabPanel",
              "props": {
                "value": {
                  "kind": "literal",
                  "value": "settings"
                },
                "label": {
                  "kind": "literal",
                  "value": "设置"
                }
              },
              "children": [
                {
                  "id": "tab-input",
                  "component": "ui.input",
                  "props": {
                    "label": {
                      "kind": "literal",
                      "value": "草稿"
                    },
                    "value": {
                      "kind": "literal",
                      "value": ""
                    }
                  }
                },
                {
                  "id": "tab-text",
                  "component": "ui.text",
                  "props": {
                    "value": {
                      "kind": "literal",
                      "value": "可以在面板内继续拖入其他组件。"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "feedback",
      "title": "交互反馈",
      "state": [],
      "children": [
        {
          "id": "feedback-heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "交互反馈"
            }
          }
        },
        {
          "id": "feedback-heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "编辑模式展开弹层内容，预览模式启用真实弹层。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "alert",
          "component": "ui.alert",
          "props": {
            "title": {
              "kind": "literal",
              "value": "基础组件已就绪"
            },
            "description": {
              "kind": "literal",
              "value": "支持成功、信息、警告和错误四种类型。"
            },
            "tone": {
              "kind": "literal",
              "value": "success"
            },
            "closable": {
              "kind": "literal",
              "value": true
            }
          }
        },
        {
          "id": "overlays",
          "component": "ui.layout",
          "props": {
            "variant": {
              "kind": "literal",
              "value": "stack"
            },
            "gap": {
              "kind": "literal",
              "value": 16
            }
          },
          "children": [
            {
              "id": "dialog",
              "component": "ui.dialog",
              "props": {
                "title": {
                  "kind": "literal",
                  "value": "确认操作"
                },
                "description": {
                  "kind": "literal",
                  "value": "Base UI 负责焦点与键盘交互"
                },
                "triggerLabel": {
                  "kind": "literal",
                  "value": "打开对话框"
                },
                "width": {
                  "kind": "literal",
                  "value": 480
                },
                "showFooter": {
                  "kind": "literal",
                  "value": true
                }
              },
              "children": [
                {
                  "id": "dialog-alert",
                  "component": "ui.alert",
                  "props": {
                    "title": {
                      "kind": "literal",
                      "value": "请确认操作"
                    },
                    "description": {
                      "kind": "literal",
                      "value": "弹层内容支持普通布局、表单和插槽。"
                    },
                    "tone": {
                      "kind": "literal",
                      "value": "info"
                    }
                  }
                },
                {
                  "id": "dialog-text",
                  "component": "ui.text",
                  "props": {
                    "value": {
                      "kind": "literal",
                      "value": "关闭后再次打开，组件仍保持挂载。"
                    }
                  }
                }
              ],
              "on": {
                "onConfirm": [
                  {
                    "id": "confirmed",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "操作完成"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "success"
                      }
                    }
                  }
                ]
              }
            },
            {
              "id": "drawer",
              "component": "ui.drawer",
              "props": {
                "title": {
                  "kind": "literal",
                  "value": "项目详情"
                },
                "triggerLabel": {
                  "kind": "literal",
                  "value": "打开抽屉"
                },
                "width": {
                  "kind": "literal",
                  "value": 420
                },
                "showFooter": {
                  "kind": "literal",
                  "value": true
                }
              },
              "children": [
                {
                  "id": "drawer-details",
                  "component": "ui.descriptions",
                  "props": {
                    "items": {
                      "kind": "literal",
                      "value": [
                        {
                          "label": "名称",
                          "value": "示例项目"
                        },
                        {
                          "label": "编号",
                          "value": "item-1"
                        }
                      ]
                    },
                    "columns": {
                      "kind": "literal",
                      "value": 1
                    }
                  }
                }
              ]
            },
            {
              "id": "notice",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "显示通知"
                }
              },
              "on": {
                "onClick": [
                  {
                    "id": "notice",
                    "action": "ui.notify",
                    "input": {
                      "title": {
                        "kind": "literal",
                        "value": "这是一条消息"
                      },
                      "description": {
                        "kind": "literal",
                        "value": "通知由当前页面实例隔离管理。"
                      },
                      "tone": {
                        "kind": "literal",
                        "value": "info"
                      }
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          "id": "loading-card",
          "component": "ui.card",
          "props": {
            "title": {
              "kind": "literal",
              "value": "加载状态"
            }
          },
          "children": [
            {
              "id": "loading",
              "component": "ui.loading",
              "props": {
                "loading": {
                  "kind": "literal",
                  "value": true
                },
                "label": {
                  "kind": "literal",
                  "value": "正在加载数据…"
                },
                "blocking": {
                  "kind": "literal",
                  "value": true
                }
              },
              "children": [
                {
                  "id": "loading-content",
                  "component": "ui.text",
                  "props": {
                    "value": {
                      "kind": "literal",
                      "value": "数据内容区域"
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
} as const;

export const selectExample = {
  "schemaVersion": "0.1.0",
  "id": "select-demo",
  "title": "选择器示例",
  "entryPageId": "select-demo",
  "dependencies": {
    "components": {
      "ui.button": "1.0.0",
      "ui.form": "1.0.0",
      "ui.formStatus": "1.0.0",
      "ui.select": "1.0.0",
      "ui.text": "1.0.0"
    },
    "actions": {}
  },
  "pages": [
    {
      "id": "select-demo",
      "title": "选择器示例",
      "state": [],
      "forms": [
        {
          "id": "model",
          "fields": [
            {
              "id": "category",
              "path": [
                "category"
              ],
              "label": "申请类别",
              "type": "string",
              "initial": "",
              "rules": [
                {
                  "kind": "required",
                  "message": "请选择申请类别"
                }
              ]
            },
            {
              "id": "priority",
              "path": [
                "priority"
              ],
              "label": "优先级",
              "type": "number",
              "initial": null,
              "rules": [
                {
                  "kind": "required",
                  "message": "请选择优先级"
                }
              ]
            }
          ]
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "选择器示例"
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "文本与数字值、禁用选项、必填校验与重置"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "form",
          "component": "ui.form",
          "props": {},
          "formId": "model",
          "children": [
            {
              "id": "category",
              "component": "ui.select",
              "props": {
                "options": {
                  "kind": "literal",
                  "value": [
                    {
                      "label": "办公用品",
                      "value": "office"
                    },
                    {
                      "label": "设备采购",
                      "value": "equipment"
                    },
                    {
                      "label": "其他",
                      "value": "other"
                    }
                  ]
                },
                "hint": {
                  "kind": "literal",
                  "value": "显示名称与提交值分别配置"
                }
              },
              "field": {
                "formId": "model",
                "fieldId": "category"
              }
            },
            {
              "id": "priority",
              "component": "ui.select",
              "props": {
                "options": {
                  "kind": "literal",
                  "value": [
                    {
                      "label": "低（数字 0）",
                      "value": 0
                    },
                    {
                      "label": "普通",
                      "value": 1
                    },
                    {
                      "label": "紧急",
                      "value": 2
                    },
                    {
                      "label": "暂不可用",
                      "value": 9,
                      "disabled": true
                    }
                  ]
                }
              },
              "field": {
                "formId": "model",
                "fieldId": "priority"
              }
            },
            {
              "id": "submit",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "校验并提交"
                },
                "type": {
                  "kind": "literal",
                  "value": "submit"
                }
              }
            },
            {
              "id": "reset",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "重置表单"
                },
                "type": {
                  "kind": "literal",
                  "value": "reset"
                },
                "variant": {
                  "kind": "literal",
                  "value": "secondary"
                }
              }
            },
            {
              "id": "status",
              "component": "ui.formStatus",
              "props": {
                "formId": {
                  "kind": "literal",
                  "value": "model"
                }
              }
            }
          ]
        }
      ]
    }
  ]
} as const;

export const multiSelectExample = {
  "schemaVersion": "0.1.0",
  "id": "multi-select-demo",
  "title": "多选选择器示例",
  "entryPageId": "multi-select-demo",
  "dependencies": {
    "components": {
      "ui.button": "1.0.0",
      "ui.form": "1.0.0",
      "ui.formStatus": "1.0.0",
      "ui.select": "1.0.0",
      "ui.text": "1.0.0"
    },
    "actions": {}
  },
  "pages": [
    {
      "id": "multi-select-demo",
      "title": "多选选择器示例",
      "state": [],
      "forms": [
        {
          "id": "model",
          "fields": [
            {
              "id": "category",
              "path": [
                "category"
              ],
              "label": "采购类别",
              "type": "array",
              "itemType": "string",
              "initial": [],
              "rules": [
                {
                  "kind": "required",
                  "message": "请选择采购类别"
                },
                {
                  "kind": "minLength",
                  "value": 2,
                  "message": "至少选择两个类别"
                }
              ]
            },
            {
              "id": "priority",
              "path": [
                "priority"
              ],
              "label": "优先级",
              "type": "array",
              "itemType": "number",
              "initial": [
                0
              ],
              "rules": [
                {
                  "kind": "maxLength",
                  "value": 2,
                  "message": "最多选择两个优先级"
                }
              ]
            }
          ]
        }
      ],
      "children": [
        {
          "id": "heading",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "多选选择器"
            }
          }
        },
        {
          "id": "heading-note",
          "component": "ui.text",
          "props": {
            "value": {
              "kind": "literal",
              "value": "同一个选择器支持单选 / 多选；多选使用文本或数字数组，可清空、校验和重置。"
            },
            "tone": {
              "kind": "literal",
              "value": "muted"
            }
          }
        },
        {
          "id": "form",
          "component": "ui.form",
          "props": {},
          "formId": "model",
          "children": [
            {
              "id": "category",
              "component": "ui.select",
              "props": {
                "options": {
                  "kind": "literal",
                  "value": [
                    {
                      "label": "办公用品",
                      "value": "office"
                    },
                    {
                      "label": "设备采购",
                      "value": "equipment"
                    },
                    {
                      "label": "其他",
                      "value": "other"
                    }
                  ]
                },
                "hint": {
                  "kind": "literal",
                  "value": "显示名称与提交值分别配置"
                },
                "multiple": {
                  "kind": "literal",
                  "value": true
                }
              },
              "field": {
                "formId": "model",
                "fieldId": "category"
              }
            },
            {
              "id": "priority",
              "component": "ui.select",
              "props": {
                "options": {
                  "kind": "literal",
                  "value": [
                    {
                      "label": "低",
                      "value": 0
                    },
                    {
                      "label": "普通",
                      "value": 1
                    },
                    {
                      "label": "紧急",
                      "value": 2
                    },
                    {
                      "label": "暂不可用",
                      "value": 9,
                      "disabled": true
                    }
                  ]
                },
                "multiple": {
                  "kind": "literal",
                  "value": true
                }
              },
              "field": {
                "formId": "model",
                "fieldId": "priority"
              }
            },
            {
              "id": "submit",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "校验并提交"
                },
                "type": {
                  "kind": "literal",
                  "value": "submit"
                }
              }
            },
            {
              "id": "reset",
              "component": "ui.button",
              "props": {
                "label": {
                  "kind": "literal",
                  "value": "重置表单"
                },
                "type": {
                  "kind": "literal",
                  "value": "reset"
                },
                "variant": {
                  "kind": "literal",
                  "value": "secondary"
                }
              }
            },
            {
              "id": "status",
              "component": "ui.formStatus",
              "props": {
                "formId": {
                  "kind": "literal",
                  "value": "model"
                }
              }
            }
          ]
        },
        {
          "id": "independent",
          "component": "ui.select",
          "props": {
            "label": {
              "kind": "literal",
              "value": "独立多选"
            },
            "value": {
              "kind": "literal",
              "value": []
            },
            "multiple": {
              "kind": "literal",
              "value": true
            },
            "options": {
              "kind": "literal",
              "value": [
                {
                  "label": "数字零",
                  "value": 0
                },
                {
                  "label": "文本零",
                  "value": "0"
                },
                {
                  "label": "暂不可用",
                  "value": "disabled",
                  "disabled": true
                }
              ]
            }
          }
        }
      ]
    }
  ]
} as const;

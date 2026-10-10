import { CloseCircleOutlined } from '@ant-design/icons';
import type { ProColumnType } from '@ant-design/pro-components';
import {
  EditableProTable,
  FooterToolbar,
  PageContainer,
  ProForm,
  ProFormDateRangePicker,
  ProFormSelect,
  ProFormText,
  ProFormTimePicker,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { App, Button, Card, Col, Popover, Row } from 'antd';
import type { FC } from 'react';
import { useRef, useState } from 'react';
import { fakeSubmitForm } from './service';
import useStyles from './style.style';

interface TableFormDateType {
  key: string;
  workId?: string;
  name?: string;
  department?: string;
  isNew?: boolean;
  editable?: boolean;
}
type InternalNamePath = (string | number)[];
interface ErrorField {
  name: InternalNamePath;
  errors: string[];
}
type FieldKey =
  | 'name'
  | 'url'
  | 'owner'
  | 'approver'
  | 'dateRange'
  | 'type'
  | 'name2'
  | 'url2'
  | 'owner2'
  | 'approver2'
  | 'dateRange2'
  | 'type2';

const tableData = [
  {
    key: '1',
    workId: '00001',
    name: 'John Brown',
    department: 'New York No. 1 Lake Park',
  },
  {
    key: '2',
    workId: '00002',
    name: 'Jim Green',
    department: 'London No. 1 Lake Park',
  },
  {
    key: '3',
    workId: '00003',
    name: 'Joe Black',
    department: 'Sidney No. 1 Lake Park',
  },
];

const AdvancedForm: FC<Record<string, any>> = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const { message } = App.useApp();
  const [error, setError] = useState<ErrorField[]>([]);
  const keyCounter = useRef(0);

  // Localized field labels map, resolved once per render
  const fieldLabels: Record<FieldKey, string> = {
    name: intl.formatMessage({
      id: 'pages.form.advancedForm.field.name',
      defaultMessage: 'Repository name',
    }),
    url: intl.formatMessage({
      id: 'pages.form.advancedForm.field.url',
      defaultMessage: 'Repository domain',
    }),
    owner: intl.formatMessage({
      id: 'pages.form.advancedForm.field.owner',
      defaultMessage: 'Repository administrator',
    }),
    approver: intl.formatMessage({
      id: 'pages.form.advancedForm.field.approver',
      defaultMessage: 'Approver',
    }),
    dateRange: intl.formatMessage({
      id: 'pages.form.advancedForm.field.dateRange',
      defaultMessage: 'Effective date',
    }),
    type: intl.formatMessage({
      id: 'pages.form.advancedForm.field.type',
      defaultMessage: 'Repository type',
    }),
    name2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.name2',
      defaultMessage: 'Task name',
    }),
    url2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.url2',
      defaultMessage: 'Task description',
    }),
    owner2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.owner2',
      defaultMessage: 'Executor',
    }),
    approver2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.approver2',
      defaultMessage: 'Owner',
    }),
    dateRange2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.dateRange2',
      defaultMessage: 'Effective date',
    }),
    type2: intl.formatMessage({
      id: 'pages.form.advancedForm.field.type2',
      defaultMessage: 'Task type',
    }),
  } as Record<FieldKey, string>;

  const getErrorInfo = (errors: ErrorField[]) => {
    const errorCount = errors.filter((item) => item.errors.length > 0).length;
    if (!errors || errorCount === 0) {
      return null;
    }
    const scrollToField = (fieldKey: string) => {
      const labelNode = document.querySelector(`label[for="${fieldKey}"]`);
      if (labelNode) {
        labelNode.scrollIntoView(true);
      }
    };
    const errorList = errors.map((err) => {
      if (!err || err.errors.length === 0) {
        return null;
      }
      const key = err.name[0] as FieldKey;
      return (
        <button
          key={key}
          type="button"
          className={styles.errorListItem}
          onClick={() => scrollToField(key)}
        >
          <CloseCircleOutlined className={styles.errorIcon} />
          <div>{err.errors[0]}</div>
          <div className={styles.errorField}>{fieldLabels[key]}</div>
        </button>
      );
    });
    return (
      <span className={styles.errorIcon}>
        <Popover
          title={intl.formatMessage({
            id: 'pages.form.advancedForm.errorPopoverTitle',
            defaultMessage: 'Form validation message',
          })}
          content={errorList}
          classNames={{
            root: styles.errorPopover,
          }}
          trigger="click"
          getPopupContainer={(trigger: HTMLElement) => {
            if (trigger?.parentNode) {
              return trigger.parentNode as HTMLElement;
            }
            return trigger;
          }}
        >
          <CloseCircleOutlined />
        </Popover>
        {errorCount}
      </span>
    );
  };
  const onFinish = async (values: Record<string, any>) => {
    setError([]);
    try {
      await fakeSubmitForm(values);
      message.success(
        intl.formatMessage({
          id: 'pages.form.advancedForm.submitSuccess',
          defaultMessage: 'Submitted successfully',
        }),
      );
    } catch {
      message.error(
        intl.formatMessage({
          id: 'pages.form.advancedForm.submitFailed',
          defaultMessage: 'Submission failed, please try again!',
        }),
      );
    }
  };
  const onFinishFailed = (errorInfo: any) => {
    setError(errorInfo.errorFields);
  };

  // Owner/approver options shared by multiple fields
  const ownerOptions = [
    {
      label: intl.formatMessage({
        id: 'pages.form.advancedForm.owner.option.xiao',
        defaultMessage: 'Fu Xiaoxiao',
      }),
      value: 'xiao',
    },
    {
      label: intl.formatMessage({
        id: 'pages.form.advancedForm.owner.option.mao',
        defaultMessage: 'Zhou Maomao',
      }),
      value: 'mao',
    },
  ];

  const typeOptions = [
    {
      label: intl.formatMessage({
        id: 'pages.form.advancedForm.type.option.private',
        defaultMessage: 'Private',
      }),
      value: 'private',
    },
    {
      label: intl.formatMessage({
        id: 'pages.form.advancedForm.type.option.public',
        defaultMessage: 'Public',
      }),
      value: 'public',
    },
  ];

  const columns: ProColumnType<TableFormDateType>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.form.advancedForm.column.name',
        defaultMessage: 'Member name',
      }),
      dataIndex: 'name',
      key: 'name',
      width: '20%',
    },
    {
      title: intl.formatMessage({
        id: 'pages.form.advancedForm.column.workId',
        defaultMessage: 'Employee ID',
      }),
      dataIndex: 'workId',
      key: 'workId',
      width: '20%',
    },
    {
      title: intl.formatMessage({
        id: 'pages.form.advancedForm.column.department',
        defaultMessage: 'Department',
      }),
      dataIndex: 'department',
      key: 'department',
      width: '40%',
    },
    {
      title: intl.formatMessage({
        id: 'pages.form.advancedForm.column.action',
        defaultMessage: 'Action',
      }),
      key: 'action',
      valueType: 'option',
      render: (_, record: TableFormDateType, _index, action) => {
        return [
          <Button
            key="eidit"
            type="link"
            onClick={() => action?.startEditable(record.key)}
          >
            {intl.formatMessage({
              id: 'pages.form.advancedForm.column.actionEdit',
              defaultMessage: 'Edit',
            })}
          </Button>,
        ];
      },
    },
  ];
  return (
    <ProForm
      layout="vertical"
      requiredMark={false}
      submitter={{
        render: (_props, dom) => {
          return (
            <FooterToolbar>
              {getErrorInfo(error)}
              {dom}
            </FooterToolbar>
          );
        },
      }}
      initialValues={{
        members: tableData,
      }}
      onFinish={onFinish}
      onFinishFailed={onFinishFailed}
    >
      <PageContainer
        content={intl.formatMessage({
          id: 'pages.form.advancedForm.pageContent',
          defaultMessage:
            'Advanced forms are commonly used in scenarios where large amounts of data are entered and submitted at once.',
        })}
      >
        <Card
          title={intl.formatMessage({
            id: 'pages.form.advancedForm.cardWarehouse',
            defaultMessage: 'Repository management',
          })}
          className={styles.card}
          variant="borderless"
        >
          <Row gutter={16}>
            <Col lg={6} md={12} sm={24}>
              <ProFormText
                label={fieldLabels.name}
                name="name"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.name.required',
                      defaultMessage: 'Please enter repository name',
                    }),
                  },
                ]}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.name.placeholder',
                  defaultMessage: 'Please enter repository name',
                })}
              />
            </Col>
            <Col
              xl={{
                span: 6,
                offset: 2,
              }}
              lg={{
                span: 8,
              }}
              md={{
                span: 12,
              }}
              sm={24}
            >
              <ProFormText
                label={fieldLabels.url}
                name="url"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.url.required',
                      defaultMessage: 'Please select',
                    }),
                  },
                ]}
                fieldProps={{
                  style: {
                    width: '100%',
                  },
                  addonBefore: 'http://',
                  addonAfter: '.com',
                }}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.url.placeholder',
                  defaultMessage: 'Please enter',
                })}
              />
            </Col>
            <Col
              xl={{
                span: 8,
                offset: 2,
              }}
              lg={{
                span: 10,
              }}
              md={{
                span: 24,
              }}
              sm={24}
            >
              <ProFormSelect
                label={fieldLabels.owner}
                name="owner"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.owner.required',
                      defaultMessage: 'Please select administrator',
                    }),
                  },
                ]}
                options={ownerOptions}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.owner.placeholder',
                  defaultMessage: 'Please select administrator',
                })}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col lg={6} md={12} sm={24}>
              <ProFormSelect
                label={fieldLabels.approver}
                name="approver"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.approver.required',
                      defaultMessage: 'Please select approver',
                    }),
                  },
                ]}
                options={ownerOptions}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.approver.placeholder',
                  defaultMessage: 'Please select approver',
                })}
              />
            </Col>
            <Col
              xl={{
                span: 6,
                offset: 2,
              }}
              lg={{
                span: 8,
              }}
              md={{
                span: 12,
              }}
              sm={24}
            >
              <ProFormDateRangePicker
                label={fieldLabels.dateRange}
                name="dateRange"
                fieldProps={{
                  style: {
                    width: '100%',
                  },
                }}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.dateRange.required',
                      defaultMessage: 'Please select effective date',
                    }),
                  },
                ]}
              />
            </Col>
            <Col
              xl={{
                span: 8,
                offset: 2,
              }}
              lg={{
                span: 10,
              }}
              md={{
                span: 24,
              }}
              sm={24}
            >
              <ProFormSelect
                label={fieldLabels.type}
                name="type"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.type.required',
                      defaultMessage: 'Please select repository type',
                    }),
                  },
                ]}
                options={typeOptions}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.type.placeholder',
                  defaultMessage: 'Please select repository type',
                })}
              />
            </Col>
          </Row>
        </Card>
        <Card
          title={intl.formatMessage({
            id: 'pages.form.advancedForm.cardTask',
            defaultMessage: 'Task management',
          })}
          className={styles.card}
          variant="borderless"
        >
          <Row gutter={16}>
            <Col lg={6} md={12} sm={24}>
              <ProFormText
                label={fieldLabels.name2}
                name="name2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.name2.required',
                      defaultMessage: 'Please enter',
                    }),
                  },
                ]}
              />
            </Col>
            <Col
              xl={{
                span: 6,
                offset: 2,
              }}
              lg={{
                span: 8,
              }}
              md={{
                span: 12,
              }}
              sm={24}
            >
              <ProFormText
                label={fieldLabels.url2}
                name="url2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.url2.required',
                      defaultMessage: 'Please select',
                    }),
                  },
                ]}
              />
            </Col>
            <Col
              xl={{
                span: 8,
                offset: 2,
              }}
              lg={{
                span: 10,
              }}
              md={{
                span: 24,
              }}
              sm={24}
            >
              <ProFormSelect
                label={fieldLabels.owner2}
                name="owner2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.owner2.required',
                      defaultMessage: 'Please select administrator',
                    }),
                  },
                ]}
                options={ownerOptions}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col lg={6} md={12} sm={24}>
              <ProFormSelect
                label={fieldLabels.approver2}
                name="approver2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.approver2.required',
                      defaultMessage: 'Please select approver',
                    }),
                  },
                ]}
                options={ownerOptions}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.approver2.placeholder',
                  defaultMessage: 'Please select approver',
                })}
              />
            </Col>
            <Col
              xl={{
                span: 6,
                offset: 2,
              }}
              lg={{
                span: 8,
              }}
              md={{
                span: 12,
              }}
              sm={24}
            >
              <ProFormTimePicker
                label={fieldLabels.dateRange2}
                name="dateRange2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.dateRange2.required',
                      defaultMessage: 'Please enter',
                    }),
                  },
                ]}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.dateRange2.placeholder',
                  defaultMessage: 'Reminder time',
                })}
                fieldProps={{
                  style: {
                    width: '100%',
                  },
                }}
              />
            </Col>
            <Col
              xl={{
                span: 8,
                offset: 2,
              }}
              lg={{
                span: 10,
              }}
              md={{
                span: 24,
              }}
              sm={24}
            >
              <ProFormSelect
                label={fieldLabels.type2}
                name="type2"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.advancedForm.type2.required',
                      defaultMessage: 'Please select repository type',
                    }),
                  },
                ]}
                options={typeOptions}
                placeholder={intl.formatMessage({
                  id: 'pages.form.advancedForm.type2.placeholder',
                  defaultMessage: 'Please select repository type',
                })}
              />
            </Col>
          </Row>
        </Card>
        <Card
          title={intl.formatMessage({
            id: 'pages.form.advancedForm.cardMembers',
            defaultMessage: 'Member management',
          })}
          variant="borderless"
        >
          <ProForm.Item name="members">
            <EditableProTable<TableFormDateType>
              recordCreatorProps={{
                record: () => {
                  keyCounter.current += 1;
                  return {
                    key: `new-${keyCounter.current}`,
                  };
                },
              }}
              columns={columns}
              rowKey="key"
            />
          </ProForm.Item>
        </Card>
      </PageContainer>
    </ProForm>
  );
};
export default AdvancedForm;

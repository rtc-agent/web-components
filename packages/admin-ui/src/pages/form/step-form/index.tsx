import {
  PageContainer,
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  StepsForm,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Result,
  Statistic,
} from 'antd';
import React, { useState } from 'react';
import type { StepDataType } from './data.d';
import useStyles from './style.style';

const StepDescriptions: React.FC<{
  stepData: StepDataType;
  bordered?: boolean;
}> = ({ stepData, bordered }) => {
  const intl = useIntl();
  const { payAccount, receiverAccount, receiverName, amount } = stepData;
  const items = [
    {
      key: 'payAccount',
      label: intl.formatMessage({
        id: 'pages.form.stepForm.payAccount',
        defaultMessage: 'Payment account',
      }),
      children: payAccount,
    },
    {
      key: 'receiverAccount',
      label: intl.formatMessage({
        id: 'pages.form.stepForm.receiverAccount',
        defaultMessage: 'Payee account',
      }),
      children: receiverAccount,
    },
    {
      key: 'receiverName',
      label: intl.formatMessage({
        id: 'pages.form.stepForm.receiverName',
        defaultMessage: 'Payee name',
      }),
      children: receiverName,
    },
    {
      key: 'amount',
      label: intl.formatMessage({
        id: 'pages.form.stepForm.amount',
        defaultMessage: 'Transfer amount',
      }),
      children: (
        <Statistic
          value={amount}
          suffix={
            <span style={{ fontSize: 14 }}>
              {intl.formatMessage({
                id: 'pages.form.stepForm.amountSuffix',
                defaultMessage: 'yuan',
              })}
            </span>
          }
          precision={2}
        />
      ),
    },
  ];
  return <Descriptions column={1} bordered={bordered} items={items} />;
};
const StepResult: React.FC<{
  onFinish: () => Promise<void>;
  children?: React.ReactNode;
}> = (props) => {
  const intl = useIntl();
  const { styles } = useStyles();
  return (
    <Result
      status="success"
      title={intl.formatMessage({
        id: 'pages.form.stepForm.resultTitle',
        defaultMessage: 'Operation successful',
      })}
      subTitle={intl.formatMessage({
        id: 'pages.form.stepForm.resultSubTitle',
        defaultMessage: 'Estimated to arrive within 2 hours',
      })}
      extra={
        <>
          <Button type="primary" onClick={props.onFinish}>
            {intl.formatMessage({
              id: 'pages.form.stepForm.resultActionAgain',
              defaultMessage: 'Transfer again',
            })}
          </Button>
          <Button>
            {intl.formatMessage({
              id: 'pages.form.stepForm.resultViewBill',
              defaultMessage: 'View bill',
            })}
          </Button>
        </>
      }
      className={styles.result}
    >
      {props.children}
    </Result>
  );
};
const StepForm: React.FC<Record<string, any>> = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const [stepData, setStepData] = useState<StepDataType>({
    payAccount: 'ant-design@alipay.com',
    receiverAccount: 'test@example.com',
    receiverName: 'Alex',
    amount: '500',
    receiverMode: 'alipay',
  });
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm<StepDataType>();
  return (
    <PageContainer
      content={intl.formatMessage({
        id: 'pages.form.stepForm.pageContent',
        defaultMessage:
          'Break down a lengthy or unfamiliar form task into multiple steps to guide users through completion.',
      })}
    >
      <Card variant="borderless">
        <StepsForm
          current={current}
          onCurrentChange={setCurrent}
          submitter={{
            render: (props, dom) => {
              if (props.step === 2) {
                return null;
              }
              return dom;
            },
          }}
        >
          <StepsForm.StepForm<StepDataType>
            formRef={{
              current: form,
            }}
            title={intl.formatMessage({
              id: 'pages.form.stepForm.step1Title',
              defaultMessage: 'Fill in transfer information',
            })}
            initialValues={stepData}
            onFinish={async (values) => {
              setStepData(values);
              return true;
            }}
          >
            <ProFormSelect
              label={intl.formatMessage({
                id: 'pages.form.stepForm.payAccount',
                defaultMessage: 'Payment account',
              })}
              width="md"
              name="payAccount"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'pages.form.stepForm.payAccount.required',
                    defaultMessage: 'Please select payment account',
                  }),
                },
              ]}
              valueEnum={{
                'ant-design@alipay.com': 'ant-design@alipay.com',
              }}
            />

            <ProForm.Group
              title={intl.formatMessage({
                id: 'pages.form.stepForm.receiverGroup',
                defaultMessage: 'Payee account',
              })}
              size={8}
            >
              <ProFormSelect
                name="receiverMode"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.stepForm.payAccount.required',
                      defaultMessage: 'Please select payment account',
                    }),
                  },
                ]}
                valueEnum={{
                  alipay: intl.formatMessage({
                    id: 'pages.form.stepForm.receiverMode.alipay',
                    defaultMessage: 'Alipay',
                  }),
                  bank: intl.formatMessage({
                    id: 'pages.form.stepForm.receiverMode.bank',
                    defaultMessage: 'Bank account',
                  }),
                }}
              />
              <ProFormText
                name="receiverAccount"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.stepForm.receiverAccount.required',
                      defaultMessage: 'Please enter payee account',
                    }),
                  },
                  {
                    type: 'email',
                    message: intl.formatMessage({
                      id: 'pages.form.stepForm.receiverAccount.emailFormat',
                      defaultMessage: 'Account name should be in email format',
                    }),
                  },
                ]}
                placeholder={intl.formatMessage({
                  id: 'pages.form.stepForm.receiverAccount.placeholder',
                  defaultMessage: 'test@example.com',
                })}
              />
            </ProForm.Group>
            <ProFormText
              label={intl.formatMessage({
                id: 'pages.form.stepForm.receiverName',
                defaultMessage: 'Payee name',
              })}
              width="md"
              name="receiverName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'pages.form.stepForm.receiverName.required',
                    defaultMessage: 'Please enter payee name',
                  }),
                },
              ]}
              placeholder={intl.formatMessage({
                id: 'pages.form.stepForm.receiverName.placeholder',
                defaultMessage: 'Please enter payee name',
              })}
            />
            <ProFormDigit
              label={intl.formatMessage({
                id: 'pages.form.stepForm.amount',
                defaultMessage: 'Transfer amount',
              })}
              name="amount"
              width="md"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'pages.form.stepForm.amount.required',
                    defaultMessage: 'Please enter transfer amount',
                  }),
                },
                {
                  pattern: /^(\d+)((?:\.\d+)?)$/,
                  message: intl.formatMessage({
                    id: 'pages.form.stepForm.amount.pattern',
                    defaultMessage: 'Please enter a valid amount',
                  }),
                },
              ]}
              placeholder={intl.formatMessage({
                id: 'pages.form.stepForm.amount.placeholder',
                defaultMessage: 'Please enter amount',
              })}
              fieldProps={{
                prefix: '￥',
              }}
            />
          </StepsForm.StepForm>

          <StepsForm.StepForm
            title={intl.formatMessage({
              id: 'pages.form.stepForm.step2Title',
              defaultMessage: 'Confirm transfer information',
            })}
          >
            <div className={styles.result}>
              <Alert
                closable
                showIcon
                message={intl.formatMessage({
                  id: 'pages.form.stepForm.confirmAlert',
                  defaultMessage:
                    "After confirming the transfer, the funds will be directly transferred to the recipient's account and cannot be refunded.",
                })}
                style={{
                  marginBottom: 24,
                }}
              />
              <StepDescriptions stepData={stepData} bordered />
              <Divider
                style={{
                  margin: '24px 0',
                }}
              />
              <ProFormText.Password
                label={intl.formatMessage({
                  id: 'pages.form.stepForm.password',
                  defaultMessage: 'Payment password',
                })}
                width="md"
                name="password"
                required={false}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.form.stepForm.password.required',
                      defaultMessage:
                        'Payment password is required for payment',
                    }),
                  },
                ]}
              />
            </div>
          </StepsForm.StepForm>
          <StepsForm.StepForm
            title={intl.formatMessage({
              id: 'pages.form.stepForm.step3Title',
              defaultMessage: 'Complete',
            })}
          >
            <StepResult
              onFinish={async () => {
                setCurrent(0);
                form.resetFields();
              }}
            >
              <StepDescriptions stepData={stepData} />
            </StepResult>
          </StepsForm.StepForm>
        </StepsForm>
        <Divider
          style={{
            margin: '40px 0 24px',
          }}
        />
        <div>
          <h3>
            {intl.formatMessage({
              id: 'pages.form.stepForm.notice',
              defaultMessage: 'Description',
            })}
          </h3>
          <h4>
            {intl.formatMessage({
              id: 'pages.form.stepForm.noticeAlipay',
              defaultMessage: 'Transfer to Alipay account',
            })}
          </h4>
          <p>
            {intl.formatMessage({
              id: 'pages.form.stepForm.noticeDesc',
              defaultMessage:
                'If needed, you can put some frequently asked questions about the product here. If needed, you can put some frequently asked questions about the product here. If needed, you can put some frequently asked questions about the product here.',
            })}
          </p>
          <h4>
            {intl.formatMessage({
              id: 'pages.form.stepForm.noticeBank',
              defaultMessage: 'Transfer to bank card',
            })}
          </h4>
          <p>
            {intl.formatMessage({
              id: 'pages.form.stepForm.noticeDesc',
              defaultMessage:
                'If needed, you can put some frequently asked questions about the product here. If needed, you can put some frequently asked questions about the product here. If needed, you can put some frequently asked questions about the product here.',
            })}
          </p>
        </div>
      </Card>
    </PageContainer>
  );
};
export default StepForm;

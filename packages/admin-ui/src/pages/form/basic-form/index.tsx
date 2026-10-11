import {
  PageContainer,
  ProForm,
  ProFormDateRangePicker,
  ProFormDependency,
  ProFormDigit,
  ProFormRadio,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { App, Card } from 'antd';
import type { FC } from 'react';
import { queryKeys } from '@/utils/queryKeys';
import { fakeSubmitForm } from './service';
import useStyles from './style.style';

const BasicForm: FC<Record<string, any>> = () => {
  const { styles } = useStyles();
  const queryClient = useQueryClient();
  const intl = useIntl();
  const { message } = App.useApp();
  const { mutate: run } = useMutation({
    mutationFn: fakeSubmitForm,
    onSuccess: () => {
      message.success(
        intl.formatMessage({
          id: 'pages.form.basicForm.submitSuccess',
          defaultMessage: 'Submitted successfully',
        }),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.basicForm.all });
    },
  });
  const onFinish = async (values: Record<string, any>) => {
    run(values);
  };
  return (
    <PageContainer
      content={intl.formatMessage({
        id: 'pages.form.basicForm.pageContent',
        defaultMessage:
          'Form pages are used to collect or validate information from users. Basic forms are common in scenarios with fewer data items.',
      })}
    >
      <Card variant="borderless">
        <ProForm
          requiredMark={false}
          style={{
            margin: 'auto',
            marginTop: 8,
            maxWidth: 600,
          }}
          name="basic"
          layout="vertical"
          initialValues={{
            public: '1',
          }}
          onFinish={onFinish}
        >
          <ProFormText
            width="md"
            label={intl.formatMessage({
              id: 'pages.form.basicForm.title.label',
              defaultMessage: 'Title',
            })}
            name="title"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.form.basicForm.title.required',
                  defaultMessage: 'Please enter title',
                }),
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.title.placeholder',
              defaultMessage: 'Give the target a name',
            })}
          />
          <ProFormDateRangePicker
            label={intl.formatMessage({
              id: 'pages.form.basicForm.date.label',
              defaultMessage: 'Date range',
            })}
            width="md"
            name="date"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.form.basicForm.date.required',
                  defaultMessage: 'Please select date range',
                }),
              },
            ]}
            placeholder={[
              intl.formatMessage({
                id: 'pages.form.basicForm.date.startPlaceholder',
                defaultMessage: 'Start date',
              }),
              intl.formatMessage({
                id: 'pages.form.basicForm.date.endPlaceholder',
                defaultMessage: 'End date',
              }),
            ]}
          />
          <ProFormTextArea
            label={intl.formatMessage({
              id: 'pages.form.basicForm.goal.label',
              defaultMessage: 'Objective description',
            })}
            width="xl"
            name="goal"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.form.basicForm.goal.required',
                  defaultMessage: 'Please enter objective description',
                }),
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.goal.placeholder',
              defaultMessage: 'Please enter your phased work objectives',
            })}
          />

          <ProFormTextArea
            label={intl.formatMessage({
              id: 'pages.form.basicForm.standard.label',
              defaultMessage: 'Metrics',
            })}
            name="standard"
            width="xl"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.form.basicForm.standard.required',
                  defaultMessage: 'Please enter metrics',
                }),
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.standard.placeholder',
              defaultMessage: 'Please enter metrics',
            })}
          />

          <ProFormText
            width="md"
            label={
              <span>
                {intl.formatMessage({
                  id: 'pages.form.basicForm.client.label',
                  defaultMessage: 'Client',
                })}
                <em className={styles.optional}>
                  {intl.formatMessage({
                    id: 'pages.form.basicForm.client.optional',
                    defaultMessage: '(Optional)',
                  })}
                </em>
              </span>
            }
            tooltip={intl.formatMessage({
              id: 'pages.form.basicForm.client.tooltip',
              defaultMessage: 'Target service recipients',
            })}
            name="client"
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.client.placeholder',
              defaultMessage:
                'Please describe the customers you serve. For internal customers, directly @name/employee ID',
            })}
          />

          <ProFormText
            width="md"
            label={
              <span>
                {intl.formatMessage({
                  id: 'pages.form.basicForm.invites.label',
                  defaultMessage: 'Reviewer',
                })}
                <em className={styles.optional}>
                  {intl.formatMessage({
                    id: 'pages.form.basicForm.invites.optional',
                    defaultMessage: '(Optional)',
                  })}
                </em>
              </span>
            }
            name="invites"
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.invites.placeholder',
              defaultMessage:
                'Please directly @name/employee ID, you can invite up to 5 people',
            })}
          />

          <ProFormDigit
            label={
              <span>
                {intl.formatMessage({
                  id: 'pages.form.basicForm.weight.label',
                  defaultMessage: 'Weight',
                })}
                <em className={styles.optional}>
                  {intl.formatMessage({
                    id: 'pages.form.basicForm.weight.optional',
                    defaultMessage: '(Optional)',
                  })}
                </em>
              </span>
            }
            name="weight"
            placeholder={intl.formatMessage({
              id: 'pages.form.basicForm.weight.placeholder',
              defaultMessage: 'Please enter',
            })}
            min={0}
            max={100}
            width="xs"
            fieldProps={{
              formatter: (value) => `${value || 0}%`,
              parser: (value) => Number(value ? value.replace('%', '') : '0'),
            }}
          />

          <ProFormRadio.Group
            options={[
              {
                value: '1',
                label: intl.formatMessage({
                  id: 'pages.form.basicForm.publicType.option.public',
                  defaultMessage: 'Public',
                }),
              },
              {
                value: '2',
                label: intl.formatMessage({
                  id: 'pages.form.basicForm.publicType.option.partialPublic',
                  defaultMessage: 'Partially public',
                }),
              },
              {
                value: '3',
                label: intl.formatMessage({
                  id: 'pages.form.basicForm.publicType.option.private',
                  defaultMessage: 'Private',
                }),
              },
            ]}
            label={intl.formatMessage({
              id: 'pages.form.basicForm.publicType.label',
              defaultMessage: 'Target public',
            })}
            help={intl.formatMessage({
              id: 'pages.form.basicForm.publicType.help',
              defaultMessage: 'Clients and reviewers are shared by default',
            })}
            name="publicType"
          />
          <ProFormDependency name={['publicType']}>
            {({ publicType }) => {
              return (
                <ProFormSelect
                  width="md"
                  name="publicUsers"
                  fieldProps={{
                    style: {
                      margin: '8px 0',
                      display:
                        publicType && publicType === '2' ? 'block' : 'none',
                    },
                  }}
                  options={[
                    {
                      value: '1',
                      label: intl.formatMessage({
                        id: 'pages.form.basicForm.publicUsers.option.colleagueA',
                        defaultMessage: 'Colleague A',
                      }),
                    },
                    {
                      value: '2',
                      label: intl.formatMessage({
                        id: 'pages.form.basicForm.publicUsers.option.colleagueB',
                        defaultMessage: 'Colleague B',
                      }),
                    },
                    {
                      value: '3',
                      label: intl.formatMessage({
                        id: 'pages.form.basicForm.publicUsers.option.colleagueC',
                        defaultMessage: 'Colleague C',
                      }),
                    },
                  ]}
                />
              );
            }}
          </ProFormDependency>
        </ProForm>
      </Card>
    </PageContainer>
  );
};
export default BasicForm;

import {
  ProFormDateTimePicker,
  ProFormRadio,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  StepsForm,
} from '@ant-design/pro-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from '@umijs/max';
import { App, Grid, Modal } from 'antd';
import React, { cloneElement, useCallback, useState } from 'react';
import { updateRule } from '@/services/ant-design-pro/api';

type UpdateFormProps = {
  trigger?: React.ReactElement<any>;
  onOk?: () => void;
  values: Partial<API.RuleListItem>;
};

const UpdateForm: React.FC<UpdateFormProps> = (props) => {
  const { onOk, values, trigger } = props;

  const intl = useIntl();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const { message } = App.useApp();
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 640;

  const { mutateAsync: run } = useMutation({
    mutationFn: updateRule,
    onSuccess: () => {
      message.success('Configuration is successful');
      queryClient.invalidateQueries({ queryKey: ['rule'] });
      onOk?.();
    },
    onError: () => {
      message.error('Configuration failed, please try again!');
    },
  });

  const onCancel = useCallback(() => {
    setOpen(false);
  }, []);

  const onOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const onFinish = useCallback(
    async (values?: any) => {
      await run({ data: values });
      onCancel();
    },
    [onCancel, run],
  );

  return (
    <>
      {trigger
        ? cloneElement(trigger, {
            onClick: onOpen,
          })
        : null}
      <StepsForm
        stepsProps={{
          size: 'small',
        }}
        stepsFormRender={(dom, submitter) => {
          return (
            <Modal
              width={modalWidth}
              styles={{
                body: {
                  padding: '32px 40px 48px',
                },
              }}
              destroyOnHidden
              title={intl.formatMessage({
                id: 'pages.searchTable.updateForm.ruleConfig',
                defaultMessage: 'Rule configuration',
              })}
              open={open}
              footer={submitter}
              onCancel={onCancel}
            >
              {dom}
            </Modal>
          );
        }}
        onFinish={onFinish}
      >
        <StepsForm.StepForm
          initialValues={values}
          title={intl.formatMessage({
            id: 'pages.searchTable.updateForm.basicConfig',
            defaultMessage: 'Basic information',
          })}
        >
          <ProFormText
            name="name"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.ruleName.nameLabel',
              defaultMessage: 'Rule name',
            })}
            width="md"
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.searchTable.updateForm.ruleName.nameRules"
                    defaultMessage="Please enter rule name!"
                  />
                ),
              },
            ]}
          />
          <ProFormTextArea
            name="desc"
            width="md"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.ruleDesc.descLabel',
              defaultMessage: 'Rule description',
            })}
            placeholder={intl.formatMessage({
              id: 'pages.searchTable.updateForm.ruleDesc.descPlaceholder',
              defaultMessage: 'Please enter at least 5 characters',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.searchTable.updateForm.ruleDesc.descRules"
                    defaultMessage="Please enter a rule description of at least 5 characters!"
                  />
                ),
                min: 5,
              },
            ]}
          />
        </StepsForm.StepForm>
        <StepsForm.StepForm
          initialValues={{
            target: '0',
            template: '0',
          }}
          title={intl.formatMessage({
            id: 'pages.searchTable.updateForm.ruleProps.title',
            defaultMessage: 'Configure rule properties',
          })}
        >
          <ProFormSelect
            name="target"
            width="md"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.object',
              defaultMessage: 'Monitoring target',
            })}
            valueEnum={{
              0: '表一',
              1: '表二',
            }}
          />
          <ProFormSelect
            name="template"
            width="md"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.ruleProps.templateLabel',
              defaultMessage: 'Rule template',
            })}
            valueEnum={{
              0: '规则模板一',
              1: '规则模板二',
            }}
          />
          <ProFormRadio.Group
            name="type"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.ruleProps.typeLabel',
              defaultMessage: 'Rule type',
            })}
            options={[
              {
                value: '0',
                label: '强',
              },
              {
                value: '1',
                label: '弱',
              },
            ]}
          />
        </StepsForm.StepForm>
        <StepsForm.StepForm
          initialValues={{
            type: '1',
            frequency: 'month',
          }}
          title={intl.formatMessage({
            id: 'pages.searchTable.updateForm.schedulingPeriod.title',
            defaultMessage: 'Set scheduling cycle',
          })}
        >
          <ProFormDateTimePicker
            name="time"
            width="md"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.schedulingPeriod.timeLabel',
              defaultMessage: 'Start time',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.searchTable.updateForm.schedulingPeriod.timeRules"
                    defaultMessage="Please select start time!"
                  />
                ),
              },
            ]}
          />
          <ProFormSelect
            name="frequency"
            label={intl.formatMessage({
              id: 'pages.searchTable.updateForm.object',
              defaultMessage: 'Monitoring target',
            })}
            width="md"
            valueEnum={{
              month: '月',
              week: '周',
            }}
          />
        </StepsForm.StepForm>
      </StepsForm>
    </>
  );
};

export default UpdateForm;

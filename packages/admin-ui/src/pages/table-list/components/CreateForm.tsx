import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ModalForm,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from '@umijs/max';
import { App, Button, Grid } from 'antd';
import type { FC } from 'react';
import { addRule } from '@/services/ant-design-pro/api';
import { queryKeys } from '@/utils/queryKeys';

interface CreateFormProps {
  reload?: ActionType['reload'];
}

const CreateForm: FC<CreateFormProps> = (props) => {
  const { reload } = props;

  const { message } = App.useApp();
  const queryClient = useQueryClient();
  /**
   * @en-US International configuration
   * @zh-CN 国际化配置
   * */
  const intl = useIntl();
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 400;

  const { mutateAsync: run, isPending: loading } = useMutation({
    mutationFn: addRule,
    onSuccess: () => {
      message.success('Added successfully');
      queryClient.invalidateQueries({ queryKey: queryKeys.rules.all });
      reload?.();
    },
    onError: () => {
      message.error('Adding failed, please try again!');
    },
  });

  return (
    <ModalForm
      title={intl.formatMessage({
        id: 'pages.searchTable.createForm.newRule',
        defaultMessage: 'New rule',
      })}
      trigger={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label={intl.formatMessage({
            id: 'pages.searchTable.new',
            defaultMessage: 'New',
          })}
        >
          <FormattedMessage id="pages.searchTable.new" defaultMessage="New" />
        </Button>
      }
      width={modalWidth}
      modalProps={{ okButtonProps: { loading } }}
      onFinish={async (value) => {
        try {
          await run({ data: value as API.RuleListItem });
          return true;
        } catch {
          return false;
        }
      }}
    >
      <ProFormText
        rules={[
          {
            required: true,
            message: (
              <FormattedMessage
                id="pages.searchTable.ruleName"
                defaultMessage="Rule name is required"
              />
            ),
          },
        ]}
        width="md"
        name="name"
      />
      <ProFormTextArea width="md" name="desc" />
    </ModalForm>
  );
};

export default CreateForm;

import {
  ModalForm,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Button, Grid, Result } from 'antd';
import type { FC } from 'react';
import type { BasicListItemDataType } from '../data.d';
import useStyles from '../style.style';

type OperationModalProps = {
  done: boolean;
  open: boolean;
  current: Partial<BasicListItemDataType> | undefined;
  onDone: () => void;
  onSubmit: (values: BasicListItemDataType) => void;
  children?: React.ReactElement;
};
const OperationModal: FC<OperationModalProps> = (props) => {
  const { styles } = useStyles();
  const intl = useIntl();
  const { done, open, current, onDone, onSubmit, children } = props;
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 640;

  return (
    <ModalForm<BasicListItemDataType>
      open={open}
      title={
        done
          ? null
          : current
            ? intl.formatMessage({
                id: 'pages.list.basicList.modal.editTitle',
                defaultMessage: 'Edit task',
              })
            : intl.formatMessage({
                id: 'pages.list.basicList.modal.addTitle',
                defaultMessage: 'Add task',
              })
      }
      className={styles.standardListForm}
      width={modalWidth}
      onFinish={async (values) => {
        onSubmit(values);
      }}
      initialValues={current}
      submitter={{
        render: (_, dom) => (done ? null : dom),
      }}
      trigger={children}
      modalProps={{
        onCancel: () => onDone(),
        destroyOnHidden: true,
        styles: {
          body: done
            ? {
                padding: '72px',
              }
            : undefined,
        },
      }}
    >
      {!done ? (
        <>
          <ProFormText
            name="title"
            label={intl.formatMessage({
              id: 'pages.list.basicList.modal.titleLabel',
              defaultMessage: 'Task name',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.list.basicList.modal.titleRequired',
                  defaultMessage: 'Please enter task name',
                }),
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.list.basicList.modal.titlePlaceholder',
              defaultMessage: 'Please enter',
            })}
          />
          <ProFormDateTimePicker
            name="createdAt"
            label={intl.formatMessage({
              id: 'pages.list.basicList.modal.startTimeLabel',
              defaultMessage: 'Start time',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.list.basicList.modal.startTimeRequired',
                  defaultMessage: 'Please select start time',
                }),
              },
            ]}
            fieldProps={{
              style: {
                width: '100%',
              },
            }}
            placeholder={intl.formatMessage({
              id: 'pages.list.basicList.modal.startTimePlaceholder',
              defaultMessage: 'Please select',
            })}
          />
          <ProFormSelect
            name="owner"
            label={intl.formatMessage({
              id: 'pages.list.basicList.modal.ownerLabel',
              defaultMessage: 'Task owner',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.list.basicList.modal.ownerRequired',
                  defaultMessage: 'Please select task owner',
                }),
              },
            ]}
            options={[
              {
                label: intl.formatMessage({
                  id: 'pages.list.basicList.modal.ownerOption.xiao',
                  defaultMessage: 'Fu Xiaoxiao',
                }),
                value: 'xiao',
              },
              {
                label: intl.formatMessage({
                  id: 'pages.list.basicList.modal.ownerOption.mao',
                  defaultMessage: 'Zhou Maomao',
                }),
                value: 'mao',
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.list.basicList.modal.ownerPlaceholder',
              defaultMessage: 'Please select administrator',
            })}
          />
          <ProFormTextArea
            name="subDescription"
            label={intl.formatMessage({
              id: 'pages.list.basicList.modal.descLabel',
              defaultMessage: 'Product description',
            })}
            rules={[
              {
                message: intl.formatMessage({
                  id: 'pages.list.basicList.modal.descRules',
                  defaultMessage:
                    'Please enter a product description of at least 5 characters!',
                }),
                min: 5,
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.list.basicList.modal.descPlaceholder',
              defaultMessage: 'Please enter at least 5 characters',
            })}
          />
        </>
      ) : (
        <Result
          status="success"
          title={intl.formatMessage({
            id: 'pages.list.basicList.modal.resultTitle',
            defaultMessage: 'Operation successful',
          })}
          subTitle={intl.formatMessage({
            id: 'pages.list.basicList.modal.resultSubTitle',
            defaultMessage:
              'A series of information descriptions, very short and can also include punctuation.',
          })}
          extra={
            <Button type="primary" onClick={onDone}>
              {intl.formatMessage({
                id: 'pages.list.basicList.modal.resultAction',
                defaultMessage: 'Got it',
              })}
            </Button>
          }
          className={styles.formResult}
        />
      )}
    </ModalForm>
  );
};
export default OperationModal;

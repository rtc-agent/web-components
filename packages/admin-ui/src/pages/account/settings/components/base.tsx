import { UploadOutlined } from '@ant-design/icons';
import type { ProFormInstance } from '@ant-design/pro-components';
import {
  ProForm,
  ProFormDependency,
  ProFormFieldSet,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { Button, Input, message, Skeleton, Upload } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { getCityOptions, provinceOptions } from '@/utils/chinaDivision';
import type { GeographicItemType } from '../data';
import { queryCity, queryCurrent, queryProvince } from '../service';
import useStyles from './index.style';

/**
 * 手机号校验器
 * 校验区号和手机号是否填写，注意每个错误分支后必须 return，
 * 否则会继续执行到 callback() 导致错误信息丢失
 */
const validatorPhone = (
  _rule: any,
  value: string[],
  callback: (message?: string) => void,
  intl: ReturnType<typeof useIntl>,
) => {
  if (!value[0]) {
    callback(
      intl.formatMessage({
        id: 'pages.account.settings.base.phoneAreaCode',
        defaultMessage: '请输入区号!',
      }),
    );
    return;
  }
  if (!value[1]) {
    callback(
      intl.formatMessage({
        id: 'pages.account.settings.base.phoneNumber',
        defaultMessage: '请输入手机号!',
      }),
    );
    return;
  }
  callback();
};

const toSelectValue = (item?: { label?: string; key?: string }) =>
  item?.key
    ? {
        label: item.label,
        value: item.key,
      }
    : undefined;

const toSelectOptions = (items: GeographicItemType[]) =>
  items
    .map((item) => {
      const label = item.name ?? item.label;
      const value = item.id ?? item.key;

      return label && value ? { label, value } : undefined;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));

/** 头像上传前校验文件类型和大小 */
const beforeAvatarUpload = (
  file: File,
  maxSizeMB: number,
  intl: ReturnType<typeof useIntl>,
) => {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    message.error(
      intl.formatMessage({
        id: 'pages.account.settings.base.avatarTypeOnly',
        defaultMessage: '只能上传图片文件!',
      }),
    );
    return false;
  }
  const isLt2M = file.size / 1024 / 1024 < maxSizeMB;
  if (!isLt2M) {
    message.error(
      intl.formatMessage(
        {
          id: 'pages.account.settings.base.avatarSizeError',
          defaultMessage: '图片大小超过 {size}MB!',
        },
        { size: maxSizeMB },
      ),
    );
    return false;
  }
  return true;
};

const BaseView: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const formRef = React.useRef<ProFormInstance>(undefined);
  // 头像 URL 状态，用于上传后更新预览
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const handleValuesChange = (changedValues: Record<string, unknown>) => {
    if ('province' in changedValues) {
      formRef.current?.setFieldValue('city', undefined);
    }
  };

  // 使用独立的 queryKey 避免与其他页面的 current-user 查询冲突
  const { data: currentUser, isLoading: loading } = useQuery({
    queryKey: ['current-user', 'settings'],
    queryFn: () => queryCurrent().then((res) => res.data),
  });

  const getAvatarURL = () => {
    // 优先使用上传后更新的头像
    if (avatarUrl) {
      return avatarUrl;
    }
    if (currentUser) {
      if (currentUser.avatar) {
        return currentUser.avatar;
      }
      const url =
        'https://gw.alipayobjects.com/zos/rmsportal/BiazfanxmamNRoxxVxka.png';
      return url;
    }
    return '';
  };

  const handleFinish = async () => {
    message.success(
      intl.formatMessage({
        id: 'pages.account.settings.base.updateSuccess',
        defaultMessage: '更新基本信息成功',
      }),
    );
  };

  return (
    <div className={styles.baseView}>
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          <div className={styles.left}>
            <ProForm
              formRef={formRef}
              layout="vertical"
              onFinish={handleFinish}
              onValuesChange={handleValuesChange}
              submitter={{
                searchConfig: {
                  submitText: intl.formatMessage({
                    id: 'pages.account.settings.base.updateBasic',
                    defaultMessage: '更新基本信息',
                  }),
                },
                render: (_, dom) => dom[1],
              }}
              initialValues={{
                ...currentUser,
                province: toSelectValue(currentUser?.geographic?.province),
                city: toSelectValue(currentUser?.geographic?.city),
                phone: currentUser?.phone?.split('-'),
              }}
              requiredMark={false}
            >
              <ProFormText
                width="md"
                name="email"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.email',
                  defaultMessage: '邮箱',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.emailRequired',
                      defaultMessage: '请输入您的邮箱!',
                    }),
                  },
                  {
                    type: 'email',
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.emailInvalid',
                      defaultMessage: '请输入有效的邮箱地址!',
                    }),
                  },
                ]}
              />
              <ProFormText
                width="md"
                name="name"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.name',
                  defaultMessage: '昵称',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.nameRequired',
                      defaultMessage: '请输入您的昵称!',
                    }),
                  },
                ]}
              />
              <ProFormTextArea
                name="profile"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.profile',
                  defaultMessage: '个人简介',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.profileRequired',
                      defaultMessage: '请输入个人简介!',
                    }),
                  },
                ]}
                placeholder={intl.formatMessage({
                  id: 'pages.account.settings.base.profilePlaceholder',
                  defaultMessage: '个人简介',
                })}
              />
              <ProFormSelect
                width="sm"
                name="country"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.country',
                  defaultMessage: '国家/地区',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.countryRequired',
                      defaultMessage: '请输入您的国家或地区!',
                    }),
                  },
                ]}
                options={[
                  {
                    label: intl.formatMessage({
                      id: 'pages.account.settings.base.countryChina',
                      defaultMessage: '中国',
                    }),
                    value: 'China',
                  },
                ]}
              />

              <ProForm.Group size={8}>
                <ProFormSelect
                  label={intl.formatMessage({
                    id: 'pages.account.settings.base.province',
                    defaultMessage: '所在省市',
                  })}
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({
                        id: 'pages.account.settings.base.provinceRequired',
                        defaultMessage: '请输入您的所在省!',
                      }),
                    },
                  ]}
                  width="sm"
                  fieldProps={{
                    labelInValue: true,
                  }}
                  name="province"
                  request={async () => {
                    const options = toSelectOptions(await queryProvince());
                    return options.length
                      ? options
                      : toSelectOptions(provinceOptions);
                  }}
                />
                <ProFormDependency name={['province']}>
                  {({ province }) => {
                    return (
                      <ProFormSelect
                        label=" "
                        params={{
                          key: province?.value,
                        }}
                        name="city"
                        width="sm"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({
                              id: 'pages.account.settings.base.cityRequired',
                              defaultMessage: '请输入您的所在城市!',
                            }),
                          },
                        ]}
                        fieldProps={{
                          labelInValue: true,
                        }}
                        disabled={!province}
                        request={async (params) => {
                          if (!params.key) {
                            return [];
                          }
                          const provinceKey = String(params.key);
                          const options = toSelectOptions(
                            await queryCity(provinceKey),
                          );
                          return options.length
                            ? options
                            : toSelectOptions(getCityOptions(provinceKey));
                        }}
                      />
                    );
                  }}
                </ProFormDependency>
              </ProForm.Group>
              <ProFormText
                width="md"
                name="address"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.address',
                  defaultMessage: '街道地址',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.addressRequired',
                      defaultMessage: '请输入您的街道地址!',
                    }),
                  },
                ]}
              />
              <ProFormFieldSet
                name="phone"
                label={intl.formatMessage({
                  id: 'pages.account.settings.base.phone',
                  defaultMessage: '联系电话',
                })}
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.account.settings.base.phoneRequired',
                      defaultMessage: '请输入您的联系电话!',
                    }),
                  },
                  {
                    validator: (
                      _rule: any,
                      value: string[],
                      callback: (message?: string) => void,
                    ) => validatorPhone(_rule, value, callback, intl),
                  },
                ]}
              >
                <Input className={styles.area_code} />
                <Input className={styles.phone_number} />
              </ProFormFieldSet>
            </ProForm>
          </div>
          <div className={styles.right}>
            <AvatarView
              avatar={getAvatarURL()}
              onAvatarChange={setAvatarUrl}
              intl={intl}
            />
          </div>
        </>
      )}
    </div>
  );
};
export default BaseView;

const AvatarView = ({
  avatar,
  onAvatarChange,
  intl,
}: {
  avatar: string;
  onAvatarChange: (url: string) => void;
  intl: ReturnType<typeof useIntl>;
}) => {
  const { styles } = useStyles();
  // 追踪上一次创建的 Object URL，避免内存泄漏
  const objectUrlRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return (
    <>
      <div className={styles.avatar_title}>
        {intl.formatMessage({
          id: 'pages.account.settings.base.avatar',
          defaultMessage: '头像',
        })}
      </div>
      <div className={styles.avatar}>
        <img src={avatar} alt="avatar" />
      </div>
      <Upload
        showUploadList={false}
        accept="image/*"
        beforeUpload={(file) => beforeAvatarUpload(file, 2, intl)}
        customRequest={({ file }) => {
          // 释放旧的 Object URL，再创建新的用于即时预览
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
          }
          const url = URL.createObjectURL(file as File);
          objectUrlRef.current = url;
          onAvatarChange(url);
        }}
        onChange={(info) => {
          if (info.file.status === 'error') {
            message.error(
              intl.formatMessage({
                id: 'pages.account.settings.base.uploadFailed',
                defaultMessage: '头像上传失败',
              }),
            );
          }
        }}
      >
        <div className={styles.button_view}>
          <Button>
            <UploadOutlined />
            {intl.formatMessage({
              id: 'pages.account.settings.base.changeAvatar',
              defaultMessage: '更换头像',
            })}
          </Button>
        </div>
      </Upload>
    </>
  );
};

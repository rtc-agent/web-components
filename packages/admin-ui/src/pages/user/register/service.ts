import { request } from '@umijs/max';

export interface StateType {
  status?: 'ok' | 'error';
  currentAuthority?: 'user' | 'guest' | 'admin';
}

export interface UserRegisterParams {
  mail: string;
  password: string;
  confirm: string;
  mobile: string;
  captcha: string;
  prefix: string;
}

/**
 * Fake user registration (mock-only endpoint)
 *
 * MOCK-ONLY: This endpoint is not yet implemented on the backend.
 * Data is provided by `./_mock.ts` for development purposes.
 *
 * TODO: Backend implementation needed for production use
 */
export async function fakeRegister(params: UserRegisterParams) {
  return request<StateType>('/api/register', {
    method: 'POST',
    data: params,
  });
}

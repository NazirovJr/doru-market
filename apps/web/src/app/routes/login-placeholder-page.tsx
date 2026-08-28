import type { ReactElement } from 'react'

// Заглушка маршрута /login — реальный экран (packages/ui + OTP-эндпоинты) подключает DTJ-028.
// TODO(EP-18): текст заменить на packages/i18n после готовности словарей (DTJ-004).
const LOGIN_PLACEHOLDER_TEXT = 'скоро'

const LoginPlaceholderPage = (): ReactElement => (
  <p data-testid="login-placeholder">{LOGIN_PLACEHOLDER_TEXT}</p>
)

export default LoginPlaceholderPage

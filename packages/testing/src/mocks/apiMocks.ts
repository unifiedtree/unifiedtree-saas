export function mockApiResponse<T>(data: T, delay = 0): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), delay))
}

export function mockApiError(message: string, status = 400): Promise<never> {
  return Promise.reject({ message, status })
}

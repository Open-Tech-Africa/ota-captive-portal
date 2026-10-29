export type StkPushRequest = {
  phoneNumber: string
  amount: number
  accountReference: string
  transactionDesc: string
}

export type StkPushResponse = {
  MerchantRequestID: string
  CheckoutRequestID: string
  ResponseCode: string
  ResponseDescription: string
  CustomerMessage: string
}

export type StkPushQueryResponse = {
  ResponseCode: string
  ResponseDescription: string
  MerchantRequestID: string
  CheckoutRequestID: string
  ResultCode: string
  ResultDesc: string
}

type OAuthResponse = {
  access_token: string
  expires_in: string
}

export type { OAuthResponse }

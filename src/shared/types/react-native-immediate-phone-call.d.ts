declare module 'react-native-immediate-phone-call' {
  interface ImmediatePhoneCall {
    immediatePhoneCall(phoneNumber: string): void;
  }

  const phoneCall: ImmediatePhoneCall;
  export default phoneCall;
}

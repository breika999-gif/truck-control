const AudioRecorderPlayer = {
  startRecorder: jest.fn().mockResolvedValue('mock_uri'),
  stopRecorder: jest.fn().mockResolvedValue('mock_uri'),
  startPlayer: jest.fn().mockResolvedValue(undefined),
  stopPlayer: jest.fn().mockResolvedValue(undefined),
  addRecordBackListener: jest.fn(),
  removeRecordBackListener: jest.fn(),
  addPlayBackListener: jest.fn(),
  removePlayBackListener: jest.fn(),
};

module.exports = AudioRecorderPlayer;
module.exports.default = AudioRecorderPlayer;

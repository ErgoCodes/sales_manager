describe('API_URL', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = original;
  });

  function load(value: string | undefined): string {
    if (value === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = value;
    let url = '';
    jest.isolateModules(() => {
      url = jest.requireActual<typeof import('../config')>('../config').API_URL;
    });
    return url;
  }

  it('drops trailing slashes so paths join cleanly', () => {
    expect(load('http://10.0.2.2:4000//')).toBe('http://10.0.2.2:4000');
  });

  it('is empty when the build profile does not set it', () => {
    expect(load(undefined)).toBe('');
  });
});

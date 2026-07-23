import { render, Box, Text } from 'ink';

function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        MyOpenClaw TUI
      </Text>
      <Text>终端客户端开发中...</Text>
    </Box>
  );
}

render(<App />);

/**
 * 模型指示器
 */
import React from 'react';
import { Text } from 'ink';
import { color } from '../../utils/colors.js';

export interface ModelIndicatorProps {
  provider: string;
  model: string;
}

export const ModelIndicator: React.FC<ModelIndicatorProps> = ({ provider, model }) => {
  return (
    <Text color={color.primary}>
      {provider}/{model}
    </Text>
  );
};

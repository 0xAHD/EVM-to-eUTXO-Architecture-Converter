import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

/* ── Mock fetch ── */

const mockConversionResponse = {
  mappingMarkdown: '# Architecture Mapping\n## Detected EVM Components\n- **ERC20**',
  flowsMarkdown: '# Transaction Flows\n## `transfer()`\nTransfer tokens.',
  diagramMarkdown: '# Component Diagram\n```\nUser -> Tx Builder\n```',
  checklistMarkdown: '# Implementation Checklist\n- [ ] Choose language',
  warnings: ['Warning 1', 'Warning 2'],
  meta: {
    detectedPatterns: ['ERC20', 'Ownable'],
    confidence: 0.85,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the header', () => {
    render(<App />);
    expect(screen.getByText(/eUTXO Converter/i)).toBeInTheDocument();
  });

  it('shows empty state initially', () => {
    render(<App />);
    expect(screen.getByText(/Paste Solidity code/i)).toBeInTheDocument();
  });

  it('has input tabs', () => {
    render(<App />);
    expect(screen.getByText('Solidity')).toBeInTheDocument();
    expect(screen.getByText('ABI (JSON)')).toBeInTheDocument();
    expect(screen.getByText('Text Description')).toBeInTheDocument();
  });

  it('has output tabs', () => {
    render(<App />);
    expect(screen.getByText('Architecture Mapping')).toBeInTheDocument();
    expect(screen.getByText('Transaction Flows')).toBeInTheDocument();
    expect(screen.getByText('Component Diagram')).toBeInTheDocument();
    expect(screen.getByText('Checklist')).toBeInTheDocument();
  });

  it('clicking Load: ERC20 populates editor', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('load-erc20'));
    const textarea = screen.getByTestId('solidity-input') as HTMLTextAreaElement;
    expect(textarea.value).toContain('SimpleToken');
    expect(textarea.value).toContain('balances');
  });

  it('clicking Load: Escrow populates editor', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('load-escrow'));
    const textarea = screen.getByTestId('solidity-input') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Escrow');
    expect(textarea.value).toContain('deposit');
  });

  it('clicking Load: Lending populates editor', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('load-lending'));
    const textarea = screen.getByTestId('solidity-input') as HTMLTextAreaElement;
    expect(textarea.value).toContain('SimpleLending');
    expect(textarea.value).toContain('borrow');
  });

  it('clicking Convert calls API and renders output', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConversionResponse),
    });

    render(<App />);

    // Load example first
    fireEvent.click(screen.getByTestId('load-erc20'));

    // Click convert
    fireEvent.click(screen.getByTestId('convert-btn'));

    // Should show loading (button shows it)
    expect(screen.getByTestId('convert-btn')).toHaveTextContent('Converting...');

    // Wait for result
    await waitFor(() => {
      expect(screen.getByText(/Detected EVM Components/i)).toBeInTheDocument();
    });

    // Check meta info
    expect(screen.getByText(/ERC20, Ownable/)).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();

    // Verify fetch was called
    expect(global.fetch).toHaveBeenCalledWith('/api/convert', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('shows error on failed API call', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Test error message' }),
    });

    render(<App />);
    fireEvent.click(screen.getByTestId('load-erc20'));
    fireEvent.click(screen.getByTestId('convert-btn'));

    await waitFor(() => {
      expect(screen.getByText(/Test error message/)).toBeInTheDocument();
    });
  });

  it('Download Report produces a markdown blob', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConversionResponse),
    });

    // Mock URL APIs
    const mockUrl = 'blob:test';
    global.URL.createObjectURL = vi.fn().mockReturnValue(mockUrl);
    global.URL.revokeObjectURL = vi.fn();

    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as unknown as HTMLElement;
      }
      return origCreateElement(tag);
    });

    render(<App />);
    fireEvent.click(screen.getByTestId('load-erc20'));
    fireEvent.click(screen.getByTestId('convert-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('download-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('download-btn'));

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });
});

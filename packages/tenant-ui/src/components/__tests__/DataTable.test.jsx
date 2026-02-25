import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable from '../DataTable.jsx';

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'active', label: 'Status', render: (val) => val ? 'Active' : 'Inactive' },
  ];

  const data = [
    { id: '1', name: 'Alice', email: 'alice@test.com', active: true },
    { id: '2', name: 'Bob', email: 'bob@test.com', active: false },
  ];

  it('renders table with data', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onClick = vi.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onClick} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onClick).toHaveBeenCalledWith(data[0]);
  });

  it('renders pagination when provided', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        pagination={{ page: 1, limit: 2, total: 10, onPageChange }}
      />
    );
    expect(screen.getByText(/Showing 1/)).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables Previous on first page', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        pagination={{ page: 1, limit: 2, total: 10, onPageChange: vi.fn() }}
      />
    );
    expect(screen.getByText('Previous')).toBeDisabled();
  });
});

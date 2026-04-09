import React from 'react'
import ReactDOM from 'react-dom'
import './index.css'
import ServerApp from './ServerApp'

class ErrorBoundary extends React.Component<any, { error: any; errorInfo: any }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }
  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ error, errorInfo });
  }
  render() {
    if (this.state.errorInfo) {
      return (
        <div style={{ padding: 20, color: 'white', background: 'red' }}>
          <h2>Something went wrong.</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ServerApp />
    </ErrorBoundary>
  </React.StrictMode>,
  document.getElementById('root')
)


/*
* @adonisjs/core
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import { Server as HttpsServer } from 'https'
import { ServerContract } from '@ioc:Adonis/Core/Server'
import { LoggerContract } from '@ioc:Adonis/Core/Logger'
import { ApplicationContract } from '@ioc:Adonis/Core/Application'
import { IncomingMessage, ServerResponse, Server, createServer } from 'http'

import { Bootstrapper } from '../Bootstrapper'
import { ErrorHandler } from '../ErrorHandler'
import { SignalsListener } from '../SignalsListener'

type ServerHandler = (req: IncomingMessage, res: ServerResponse) => any
type CustomServerCallback = (handler: ServerHandler) => Server | HttpsServer

/**
 * Exposes the API to setup the application for starting the HTTP
 * server.
 */
export class HttpServer {
  /**
   * Reference to bootstrapper
   */
  private _bootstrapper = new Bootstrapper(this._appRoot)

  /**
   * Reference to core http server.
   */
  private _server: ServerContract

  /**
   * Reference to core logger
   */
  private _logger: LoggerContract

  /**
   * Whether or not the application has been wired.
   */
  private _wired: boolean = false

  /**
   * Listens for unix signals to kill long running
   * processes.
   */
  private _signalsListener = new SignalsListener()

  /**
   * Reference to the application.
   */
  public application: ApplicationContract

  constructor (private _appRoot: string) {
  }

  /**
   * Wires up everything, so that we are ready to kick start
   * the HTTP server.
   */
  private async _wire () {
    if (this._wired) {
      return
    }

    /**
     * Setting up the application. Nothing is registered yet.
     * Just calls to `ioc.use` are available.
     */
    this.application = this._bootstrapper.setup()
    this.injectBootstrapper(this._bootstrapper)

    /**
     * Registering providers
     */
    this._bootstrapper.registerProviders(false)

    /**
     * Registering directories to be autoloaded
     */
    this._bootstrapper.registerAutoloads()

    /**
     * Booting providers
     */
    await this._bootstrapper.bootProviders()

    /**
     * Importing preloaded files
     */
    this._bootstrapper.registerPreloads()
  }

  /**
   * Sets the logger reference
   */
  private _setLogger () {
    this._logger = this.application.container.use('Adonis/Core/Logger')
  }

  /**
   * Sets the server reference
   */
  private _setServer () {
    this._server = this.application.container.use('Adonis/Core/Server')
  }

  /**
   * Closes the underlying HTTP server
   */
  private _closeHttpServer () {
    return new Promise((resolve) => this._server.instance!.close(() => resolve()))
  }

  /**
   * Monitors the HTTP server for close and error events, so that
   * we can perform a graceful shutdown
   */
  private _monitorHttpServer () {
    this._server.instance!.on('close', async () => {
      this._logger.trace('closing http server')
      this._server.instance!.removeAllListeners()
      this.application.isReady = false
    })

    this._server.instance!.on('error', async (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        this._server.instance!.close()
        return
      }

      await this.kill(3000)
    })
  }

  /**
   * Inject bootstrapper from outside. This is mainly done
   * when you have bootstrapped application somewhere
   * else and now want to start the HTTP server.
   */
  public injectBootstrapper (boostrapper: Bootstrapper) {
    this._bootstrapper = boostrapper
    this.application = this._bootstrapper.application
    this.application.environment = 'web'
    this._wired = true
  }

  /**
   * Creates the HTTP server to handle incoming requests. The server is just
   * created but not listening on any port.
   */
  public createServer (serverCallback?: CustomServerCallback) {
    /**
     * Optimizing the server by pre-compiling routes and middleware
     */
    this._logger.trace('optimizing http server handler')
    this._server.optimize()

    /**
     * Bind exception handler to handle exceptions occured during HTTP requests.
     */
    this._logger.trace('binding %s exception handler', this.application.exceptionHandlerNamespace)
    this._server.errorHandler(this.application.exceptionHandlerNamespace)

    const handler = this._server.handle.bind(this._server)
    this._server.instance = serverCallback ? serverCallback(handler) : createServer(handler)
  }

  /**
   * Starts the http server a given host and port
   */
  public listen () {
    return new Promise(async (resolve) => {
      await this._bootstrapper.executeReadyHooks()

      const Env = this.application.container.use('Adonis/Core/Env')
      const host = Env.get('HOST', '0.0.0.0') as string
      const port = Number(Env.get('PORT', '3333') as string)

      this._server.instance!.listen(port, host, () => {
        this._logger.info('started server on %s:%s', host, port)
        this.application.isReady = true
        resolve()
      })
    })
  }

  /**
   * Start the HTTP server by wiring up the application
   */
  public async start (serverCallback?: CustomServerCallback) {
    try {
      await this._wire()
      this._setLogger()
      this._setServer()
      this.createServer(serverCallback)
      await this.listen()
      this._monitorHttpServer()
      this._signalsListener.listen(() => this.close())
    } catch (error) {
      new ErrorHandler(this.application).handleError(error)
    }
  }

  /**
   * Prepares the application for shutdown. This method will invoke `shutdown`
   * lifecycle method on the providers and closes the `httpServer`.
   */
  public async close () {
    this.application.isShuttingDown = true

    /**
     * Close the HTTP server before excuting the `shutdown` hooks. This ensures that
     * we are not accepting any new request during cool off.
     */
    await this._closeHttpServer()
    await this._bootstrapper.executeShutdownHooks()
  }

  /**
   * Kills the http server process by attempting to perform a graceful
   * shutdown or killing the app forcefully as waiting for configured
   * seconds.
   */
  public async kill (waitTimeout: number = 3000) {
    this._logger.trace('forcefully killing http server')

    try {
      await Promise.race([this.close(), new Promise((resolve) => {
        setTimeout(resolve, waitTimeout)
      })])
      process.exit(0)
    } catch (error) {
      new ErrorHandler(this.application).handleError(error).finally(() => process.exit(1))
    }
  }
}

/*
* @adonisjs/core
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import { Ace } from './Ace'
import { HttpServer } from './HttpServer'
import { Bootstrapper } from './Bootstrapper'

/**
 * Ignitor is used to wireup different pieces of AdonisJs to bootstrap
 * the application.
 */
export class Ignitor {
  constructor (private _appRoot: string) {}

  /**
   * Returns instance of bootstrapper to boostrap
   * the application
   */
  public boostrapper () {
    return new Bootstrapper(this._appRoot)
  }

  /**
   * Returns instance of server to start
   * the HTTP server
   */
  public httpServer () {
    return new HttpServer(this._appRoot)
  }

  /**
   * Returns instance of ace to handle console
   * commands
   */
  public ace () {
    return new Ace(this._appRoot)
  }
}

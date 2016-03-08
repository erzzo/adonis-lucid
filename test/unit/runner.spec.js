'use strict'

/**
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

/* global describe, it, before,after */
const Runner = require('../../src/Runner')
const Database = require('../../src/Database')
const Schema = require('../../src/Schema')
const _ = require('lodash')
const chai = require('chai')
const filesFixtures = require('./fixtures/files')
const config = require('./helpers/config')
const expect = chai.expect
require('co-mocha')

const Config = {
  get: function () {
    return 'adonis_migrations'
  }
}

describe('Runner', function () {
  before(function * () {
    Database._setConfigProvider(config)
    yield filesFixtures.createDir()
  })

  after(function * () {
    yield filesFixtures.cleanStorage()
    yield Database.schema.dropTableIfExists('adonis_migrations')
    yield Database.schema.dropTableIfExists('users')
    yield Database.connection('alternateConnection').schema.dropTableIfExists('accounts')
    Database.close()
    Database.close()
  })

  it('should make migrations table', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeMigrationsTable()
    const columns = yield runner.database.table('adonis_migrations').columnInfo()
    expect(columns).to.be.an('object')
    expect(_.keys(columns)).deep.equal(['id', 'name', 'batch', 'migration_time'])
    yield runner.database.schema.dropTable('adonis_migrations')
  })

  it('should make lock table', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeLockTable()
    const columns = yield runner.database.table('adonis_migrations_lock').columnInfo()
    expect(columns).to.be.an('object')
    expect(_.keys(columns)).deep.equal(['id', 'is_locked'])
    yield runner.database.schema.dropTable('adonis_migrations_lock')
  })

  it('should return false when there is no lock', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeLockTable()
    const isLocked = yield runner._checkLock()
    expect(isLocked).to.equal(false)
    yield runner.database.schema.dropTable('adonis_migrations_lock')
  })

  it('should add a lock to the lock table', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeLockTable()
    yield runner._addLock()
    const lock = yield runner.database.table('adonis_migrations_lock').where('is_locked', 1)
    expect(lock.length).to.equal(1)
    yield runner.database.schema.dropTable('adonis_migrations_lock')
  })

  it('should throw an error when a table has been locked', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeLockTable()
    yield runner._addLock()
    try {
      yield runner._checkLock()
      expect(true).to.equal(false)
    } catch (e) {
      expect(e.message).to.match(/Migrations are locked/i)
    }
    yield runner.database.schema.dropTable('adonis_migrations_lock')
  })

  it('should free an added lock by deleting the lock table', function * () {
    const runner = new Runner(Database, Config)
    yield runner._makeLockTable()
    yield runner._addLock()
    yield runner._freeLock()
    try {
      yield runner.database.table('adonis_migrations_lock').where('is_locked', 1)
      expect(true).to.equal(false)
    } catch (e) {
      expect(e.code).to.be.oneOf(['ER_NO_SUCH_TABLE', 'SQLITE_ERROR'])
    }
  })

  it('should return diff of migrations to be executed', function * () {
    const runner = new Runner(Database, Config)
    class Users extends Schema {
      up () {
        this.table('users', function (table) {
          table.increments()
          table.string('username')
        })
      }
    }
    const migrations = {'2015-01-20': Users}
    const diff = yield runner._diff(migrations, 'up')
    expect(diff).deep.equal(_.keys(migrations))
    yield runner.database.schema.dropTable('adonis_migrations')
  })

  it('should return diff of migrations to be rollback', function * () {
    const runner = new Runner(Database, Config)
    class Users extends Schema {
      up () {
        this.table('users', function (table) {
          table.increments()
          table.string('username')
        })
      }
      down () {
        this.drop('users')
      }
    }
    const migrations = {'2015-01-20': Users}
    const diff = yield runner._diff(migrations, 'down')
    expect(diff).deep.equal([])
    yield runner.database.schema.dropTable('adonis_migrations')
  })

  it('should migrate the database by calling the up method', function * () {
    const runner = new Runner(Database, Config)
    class Users extends Schema {
      up () {
        this.create('users', function (table) {
          table.increments()
          table.string('username')
        })
      }
    }
    const migrations = {'2015-01-20': Users}
    const result = yield runner.up(migrations)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrations))
    const usersTable = yield runner.database.table('users').columnInfo()
    expect(usersTable).to.be.an('object')
    expect(_.keys(usersTable)).deep.equal(['id', 'username'])
    yield runner.database.schema.dropTable('users')
    yield runner.database.schema.dropTable('adonis_migrations')
  })

  it('should rollback the recently executed migrations', function * () {
    const runner = new Runner(Database, Config)
    const rollbackRunner = new Runner(Database, Config)
    class Users extends Schema {
      up () {
        this.create('users', function (table) {
          table.increments()
          table.string('username')
        })
      }

      down () {
        this.table('users', function (table) {
          table.dropColumn('username')
        })
      }
    }
    const migrations = {'2015-01-20': Users}
    const result = yield runner.up(migrations)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrations))

    const rollback = yield rollbackRunner.down(migrations)
    expect(rollback.status).to.equal('completed')
    expect(rollback.migrated).deep.equal(_.keys(migrations))

    const usersTable = yield runner.database.table('users').columnInfo()
    expect(usersTable).to.be.an('object')
    expect(_.keys(usersTable)).deep.equal(['id'])

    yield runner.database.schema.dropTable('adonis_migrations')
    yield runner.database.schema.dropTable('users')
  })

  it('should be able to use a different connection for a given schema', function * () {
    const runner = new Runner(Database, Config)
    class Accounts extends Schema {
      static get connection () {
        return 'alternateConnection'
      }

      up () {
        this.create('accounts', function (table) {
          table.increments()
          table.string('account_name')
        })
      }
    }
    const migrations = {'2015-01-20': Accounts}
    const result = yield runner.up(migrations)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrations))

    try {
      yield runner.database.table('accounts')
      expect(true).to.equal(false)
    } catch (e) {
      expect(e.code).to.be.oneOf(['ER_NO_SUCH_TABLE', 'SQLITE_ERROR'])
      const accounts = yield runner.database.connection('alternateConnection').table('accounts').columnInfo()
      expect(accounts).to.be.an('object')
      expect(_.keys(accounts)).deep.equal(['id', 'account_name'])
    }
    yield runner.database.schema.dropTable('adonis_migrations')
    yield runner.database.connection('alternateConnection').schema.dropTable('accounts')
  })

  it('should be able to rollback migrations when schema is using a different connection', function * () {
    const runner = new Runner(Database, Config)
    const rollbackRunner = new Runner(Database, Config)
    class Accounts extends Schema {
      static get connection () {
        return 'alternateConnection'
      }

      up () {
        this.create('accounts', function (table) {
          table.increments()
          table.string('account_name')
        })
      }

      down () {
        this.table('accounts', function (table) {
          table.dropColumn('account_name')
        })
      }
    }
    const migrations = {'2015-01-20': Accounts}
    const result = yield runner.up(migrations)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrations))

    const rollback = yield rollbackRunner.down(migrations)
    expect(rollback.status).to.equal('completed')
    expect(rollback.migrated).deep.equal(_.keys(migrations))

    const accounts = yield runner.database.connection('alternateConnection').table('accounts').columnInfo()
    expect(accounts).to.be.an('object')
    expect(_.keys(accounts)).deep.equal(['id'])

    const migrationsTable = yield runner.database.table('adonis_migrations')
    expect(migrationsTable.length).to.equal(0)

    yield runner.database.schema.dropTable('adonis_migrations')
    yield runner.database.connection('alternateConnection').schema.dropTable('accounts')
  })

  it('should only rollback to the previous batch', function * () {
    class User extends Schema {
      up () {
        this.create('users', function (table) {
          table.increments()
          table.string('username')
        })
      }

      down () {
        this.table('users', function (table) {
          table.dropColumn('username')
        })
      }
    }

    class Account extends Schema {
      static get connection () {
        return 'alternateConnection'
      }

      up () {
        this.create('accounts', function (table) {
          table.increments()
          table.string('account_name')
        })
      }

      down () {
        this.table('accounts', function (table) {
          table.dropColumn('account_name')
        })
      }
    }

    const migrationsB1 = {'2016-01-30_create_users_table': User}
    const migrationsB2 = {'2016-01-30_create_accouts_table': Account}
    let allMigs = {}
    _.merge(allMigs, migrationsB1, migrationsB2)
    let runner, result, rollback

    runner = new Runner(Database, Config)
    result = yield runner.up(migrationsB1)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrationsB1))

    runner = new Runner(Database, Config)
    result = yield runner.up(migrationsB2)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrationsB2))

    runner = new Runner(Database, Config)
    rollback = yield runner.down(allMigs)
    expect(rollback.status).to.equal('completed')
    expect(rollback.migrated).deep.equal(_.keys(migrationsB2))

    const usersInfo = yield runner.database.table('users').columnInfo()
    expect(_.keys(usersInfo)).deep.equal(['id', 'username'])

    const accountsInfo = yield runner.database.connection('alternateConnection').table('accounts').columnInfo()
    expect(_.keys(accountsInfo)).deep.equal(['id'])
    yield runner.database.schema.dropTable('adonis_migrations')
    yield runner.database.schema.dropTable('users')
    yield runner.database.connection('alternateConnection').schema.dropTable('accounts')
  })

  it('should rollback to a given specific batch', function * () {
    class User extends Schema {
      up () {
        this.create('users', function (table) {
          table.increments()
          table.string('username')
        })
      }

      down () {
        this.table('users', function (table) {
          table.dropColumn('username')
        })
      }
    }

    class Account extends Schema {
      static get connection () {
        return 'alternateConnection'
      }

      up () {
        this.create('accounts', function (table) {
          table.increments()
          table.string('account_name')
        })
      }

      down () {
        this.table('accounts', function (table) {
          table.dropColumn('account_name')
        })
      }
    }

    const migrationsB1 = {'2016-01-30_create_users_table': User}
    const migrationsB2 = {'2016-01-30_create_accouts_table': Account}
    let allMigs = {}
    _.merge(allMigs, migrationsB1, migrationsB2)
    let runner, result, rollback

    runner = new Runner(Database, Config)
    result = yield runner.up(migrationsB1)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrationsB1))

    runner = new Runner(Database, Config)
    result = yield runner.up(migrationsB2)
    expect(result.status).to.equal('completed')
    expect(result.migrated).deep.equal(_.keys(migrationsB2))

    runner = new Runner(Database, Config)
    rollback = yield runner.down(allMigs, 0)
    expect(rollback.status).to.equal('completed')
    expect(rollback.migrated).deep.equal(_.reverse(_.keys(allMigs)))

    const usersInfo = yield runner.database.table('users').columnInfo()
    expect(_.keys(usersInfo)).deep.equal(['id'])

    const accountsInfo = yield runner.database.connection('alternateConnection').table('accounts').columnInfo()
    expect(_.keys(accountsInfo)).deep.equal(['id'])
    yield runner.database.schema.dropTable('adonis_migrations')
    yield runner.database.schema.dropTable('users')
    yield runner.database.connection('alternateConnection').schema.dropTable('accounts')
  })
})
